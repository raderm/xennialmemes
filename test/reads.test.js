/* Guards against queries that quietly read whole tables (D1 bills rows read). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createD1, createR2, fakePng } from './helpers.js';
import { imageIsPublished, setPostStatus } from '../src/lib/db.js';
import { invalidateTagCounts, relatedPosts, usedTags } from '../src/lib/tags.js';
import { runIngest } from '../src/ingest/index.js';
import { normalizeCaption } from '../src/ingest/caption.js';

/** Run fn against a D1 that records every SQL statement, then return each statement's query plan. */
async function plansOf(db, fn) {
  const seen = [];
  const spy = { ...db, prepare: (sql) => (seen.push(sql), db.prepare(sql)) };
  await fn(spy);
  return seen.map((sql) => ({
    sql,
    plan: db.raw.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((r) => r.detail).join(' | ')
  }));
}

function counting(db) {
  const counter = { n: 0 };
  return { db: { ...db, prepare: (sql) => (counter.n++, db.prepare(sql)) }, counter };
}

const caption = async ({ hint }) =>
  normalizeCaption({
    title: hint,
    alt_text: hint,
    description: '',
    filename: hint,
    tags: [{ tag: 'pogs', label: 'Pogs', category: 'toys' }, { tag: hint.split(' ')[0], label: hint, category: 'other' }]
  });
const drive = (ids) => ({ files: ids.map((id) => ({ id, name: `${id} meme.png`, mimeType: 'image/png' })), async listImages() { return this.files; }, download: async () => fakePng(800, 600) });

async function seeded(n = 12) {
  const env = { DB: createD1(), MEDIA: createR2(), DRIVE_FOLDER_ID: 'f', INGEST_BATCH: String(n) };
  const d = drive(Array.from({ length: n }, (_, i) => `file${i}`));
  await runIngest(env, { drive: d, caption });
  return { env, d };
}

test('image check uses the image and thumbnail indexes, not a scan of posts', async () => {
  const { env } = await seeded();
  const plans = await plansOf(env.DB, (db) => imageIsPublished(db, 'file0-meme.png'));
  assert.equal(plans.length, 1);
  assert.match(plans[0].plan, /USING INDEX xm_post_image_key/);
  assert.match(plans[0].plan, /USING INDEX xm_post_thumb_key/);
  assert.doesNotMatch(plans[0].plan, /xm_post_status_id|SCAN xm_post/);
});

test('related posts start from the post\'s tags, not from every published post', async () => {
  const { env } = await seeded();
  const plans = await plansOf(env.DB, (db) => relatedPosts(db, 1));
  assert.doesNotMatch(plans[0].plan, /xm_post_status_id|SCAN xm_post\b/);
  assert.match(plans[0].plan, /SEARCH p USING INTEGER PRIMARY KEY/);
  assert.ok((await relatedPosts(env.DB, 1)).length > 0);
});

test('tag counts are computed once and reused until something changes', async () => {
  const { env } = await seeded(6);
  const first = await usedTags(env.DB);
  assert.equal(first[0].tag, 'pogs');
  assert.equal(first[0].n, 6);

  const { db, counter } = counting(env.DB);
  const again = await usedTags(db, { limit: 1 });
  assert.equal(counter.n, 1, 'a cached read is a single one-row query');
  assert.deepEqual(again, first.slice(0, 1));

  // Hiding a post clears the cache; the next read recounts.
  await setPostStatus(env.DB, 1, 'hidden');
  assert.equal((await usedTags(env.DB))[0].n, 5);

  // Direct changes stay cached until invalidated.
  env.DB.raw.prepare("UPDATE xm_post SET status = 'hidden' WHERE id = 2").run();
  assert.equal((await usedTags(env.DB))[0].n, 5);
  await invalidateTagCounts(env.DB);
  assert.equal((await usedTags(env.DB))[0].n, 4);
});

test('the 10-minute Drive check reads one row when the folder has not changed', async () => {
  const { env, d } = await seeded(3);
  const { db, counter } = counting(env.DB);
  const quiet = await runIngest({ ...env, DB: db }, { drive: d, caption });
  assert.equal(quiet.unchanged, true);
  assert.equal(counter.n, 1);

  // A new file changes the listing: the run does real work, then goes quiet again.
  d.files.push({ id: 'new', name: 'new meme.png', mimeType: 'image/png' });
  const busy = await runIngest(env, { drive: d, caption });
  assert.equal(busy.created.length, 1);
  assert.equal((await runIngest(env, { drive: d, caption })).unchanged, true);

  // A removal is noticed, and the tag counts follow it.
  d.files = d.files.filter((f) => f.id !== 'new');
  const removed = await runIngest(env, { drive: d, caption });
  assert.equal(removed.removed, 1);
  assert.equal((await usedTags(env.DB))[0].n, 3);
});

test('a failing file keeps the check running so it is retried', async () => {
  const env = { DB: createD1(), MEDIA: createR2(), DRIVE_FOLDER_ID: 'f', INGEST_BATCH: '5' };
  const d = drive(['ok', 'bad']);
  const flaky = async (args) => {
    if (args.hint.startsWith('bad')) throw new Error('Claude API error (500)');
    return caption(args);
  };
  const quiet = { error() {} };
  const r1 = await runIngest(env, { drive: d, caption: flaky, log: quiet });
  assert.equal(r1.failed.length, 1);
  const r2 = await runIngest(env, { drive: d, caption: flaky, log: quiet });
  assert.notEqual(r2.unchanged, true, 'retried, not skipped');
  await runIngest(env, { drive: d, caption: flaky, log: quiet });
  // After three failures the file is given up on and the folder counts as settled.
  const r4 = await runIngest(env, { drive: d, caption: flaky, log: quiet });
  assert.equal(r4.failed.length, 0);
  assert.equal((await runIngest(env, { drive: d, caption: flaky })).unchanged, true);
});

test('everything still works before the xm_state migration has run', async () => {
  const { env, d } = await seeded(3);
  env.DB.raw.exec('DROP TABLE xm_state');
  assert.equal((await usedTags(env.DB))[0].n, 3);
  await setPostStatus(env.DB, 1, 'hidden');
  d.files.push({ id: 'x', name: 'x meme.png', mimeType: 'image/png' });
  assert.equal((await runIngest(env, { drive: d, caption })).created.length, 1);
});
