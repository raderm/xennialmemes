import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createD1, createR2, fakePng, fakeVerify, request } from './helpers.js';
import { createMatcher, mergeTag, relatedPosts, relatedTags, resolveTags, tagKey, usedTags } from '../src/lib/tags.js';
import { normalizeCaption, captionImage } from '../src/ingest/caption.js';
import { runIngest } from '../src/ingest/index.js';
import { runTagUpkeep } from '../src/ingest/tagUpkeep.js';
import { handleSite } from '../src/site/routes.js';

/* ---- matching ------------------------------------------------------------- */

test('tagKey collapses spelling variants', () => {
  assert.equal(tagKey('1990s-cartoons'), tagKey('90s-cartoon'));
  assert.equal(tagKey('the-simpsons'), tagKey('simpsons'));
  assert.equal(tagKey('video-games'), tagKey('videogame'));
  assert.equal(tagKey('nineties-tv'), tagKey('90s-tv'));
  assert.notEqual(tagKey('80s-tv'), tagKey('90s-tv'));
});

test('matcher reuses existing tags, follows aliases, catches typos', () => {
  const match = createMatcher(
    [{ tag: 'saved-by-the-bell' }, { tag: 'tamagotchi' }, { tag: 'dial-up-internet' }],
    new Map([['dialup', 'dial-up-internet']])
  );
  assert.equal(match('saved-by-the-bell'), 'saved-by-the-bell');
  assert.equal(match('saved-by-bell'), 'saved-by-the-bell');
  assert.equal(match('tamagotchis'), 'tamagotchi');
  assert.equal(match('tamagochi'), 'tamagotchi', 'one-letter typo');
  assert.equal(match('dialup'), 'dial-up-internet', 'alias');
  assert.equal(match('pogs'), null);
  assert.equal(match('tv'), null, 'short keys never fuzzy-match');
});

test('resolveTags keeps the vocabulary, creates only new tags, dedupes', () => {
  const match = createMatcher([{ tag: 'mixtapes' }]);
  const { tags, created } = resolveTags(
    [
      { tag: 'mixtape', label: 'Mixtape', category: 'music' },
      { tag: 'walkman', label: 'Walkman', category: 'tech' },
      { tag: 'mixtapes', label: 'Mixtapes', category: 'music' }
    ],
    match
  );
  assert.deepEqual(tags, ['mixtapes', 'walkman']);
  assert.deepEqual(created, [{ tag: 'walkman', label: 'Walkman', category: 'tech' }]);
});

test('captionImage shows Claude the existing vocabulary', async () => {
  let body;
  const fetchImpl = async (_url, init) => {
    body = JSON.parse(init.body);
    return new Response(
      JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ title: 't', alt_text: 'a', description: 'd', filename: 'f', tags: [] }) }] })
    );
  };
  await captionImage({
    bytes: fakePng(10, 10),
    mimeType: 'image/png',
    apiKey: 'k',
    fetchImpl,
    vocab: [{ tag: 'pogs', label: 'Pogs', category: 'toys', n: 4 }]
  });
  const texts = body.messages[0].content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  assert.match(texts, /pogs \| Pogs \| toys \| 4/);
  assert.deepEqual(body.output_config.format.schema.properties.tags.items.properties.category.enum.slice(0, 2), ['tv-movies', 'music']);
});

/* ---- ingest + vocabulary -------------------------------------------------- */

function env(extra = {}) {
  return { DB: createD1(), MEDIA: createR2(), DRIVE_FOLDER_ID: 'folder', INGEST_BATCH: '20', E9_ADMIN_API_KEY: 'e9key_admin', ...extra };
}

function drive(files) {
  return { files, listImages: async function () { return this.files; }, download: async () => fakePng(800, 600) };
}

/** Each file name says which tags Claude "sees": "a+b.png" -> tags a, b. */
function scriptedCaption(seen) {
  return async ({ hint, vocab }) => {
    seen?.push(vocab.map((t) => t.tag));
    const names = hint.split(' — ')[0].split('+');
    return normalizeCaption({
      title: names.join(' and '),
      alt_text: `Alt ${hint}`,
      description: 'd',
      filename: names.join('-'),
      tags: names.map((n) => ({ tag: n, label: n.toUpperCase(), category: n === 'pogs' ? 'toys' : 'tv-movies' }))
    });
  };
}

let fileCounter = 0;
async function seed(e, names) {
  const files = names.map((n) => ({ id: `f${fileCounter++}`, name: `${n}.png`, mimeType: 'image/png' }));
  const seen = [];
  const result = await runIngest(e, { drive: drive(files), caption: scriptedCaption(seen) });
  return { result, seen };
}

test('ingest grows the vocabulary within a run and maps variants onto it', async () => {
  const e = env();
  const { result, seen } = await seed(e, ['pogs+saved by the bell', 'pog+the saved by the bell', 'pogs+tamagotchi']);
  assert.deepEqual(result.created.map((c) => c.tags), [
    ['pogs', 'saved-by-the-bell'],
    ['pogs', 'saved-by-the-bell'],
    ['pogs', 'tamagotchi']
  ]);
  assert.deepEqual(seen[0], [], 'first meme: empty vocabulary');
  assert.ok(seen[1].includes('pogs'), 'second meme sees tags the first one added');
  const tags = await usedTags(e.DB);
  assert.deepEqual(tags.map((t) => [t.tag, t.n]), [['pogs', 3], ['saved-by-the-bell', 2], ['tamagotchi', 1]]);
  assert.equal(tags[0].category, 'toys');
});

test('related tags and related posts weigh shared tags', async () => {
  const e = env();
  await seed(e, ['pogs+saved by the bell', 'pogs+saved by the bell', 'pogs+tamagotchi', 'pogs+trapper keeper']);
  const rel = await relatedTags(e.DB, 'pogs');
  assert.equal(rel[0].tag, 'saved-by-the-bell');
  const first = e.DB.raw.prepare("SELECT id FROM xm_post ORDER BY id LIMIT 1").get().id;
  const posts = await relatedPosts(e.DB, first);
  assert.equal(posts[0].slug, e.DB.raw.prepare("SELECT slug FROM xm_post ORDER BY id LIMIT 1 OFFSET 1").get().slug, 'the post sharing the rarer tag ranks first');
  assert.equal(posts.length, 3);
});

test('mergeTag moves posts, rewrites post JSON, and leaves a redirecting alias', async () => {
  const e = env();
  await seed(e, ['pogs+milk caps', 'milk caps+tamagotchi']);
  const moved = await mergeTag(e.DB, 'milk-caps', 'pogs');
  assert.equal(moved, 2);
  const rows = e.DB.raw.prepare('SELECT tags FROM xm_post ORDER BY id').all().map((r) => JSON.parse(r.tags));
  assert.deepEqual(rows, [['pogs'], ['pogs', 'tamagotchi']]);
  assert.equal(e.DB.raw.prepare("SELECT COUNT(*) AS n FROM xm_tag WHERE tag='milk-caps'").get().n, 0);
  const deps = { verifySession: fakeVerify };
  const res = await handleSite(request('/tag/milk-caps?before=9'), e, deps);
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), 'https://xennialmemes.com/tag/pogs?before=9');
  // A later merge of pogs carries the old alias along.
  await seed(e, ['pog collecting']);
  await mergeTag(e.DB, 'pogs', 'pog-collecting');
  assert.equal(e.DB.raw.prepare("SELECT tag FROM xm_tag_alias WHERE alias='milk-caps'").get().tag, 'pog-collecting');
});

/* ---- daily upkeep ------------------------------------------------------- */

test('upkeep merges duplicates, fixes labels, describes busy tags, and only reviews new tags once', async () => {
  const e = env({ TAG_DESCRIBE_MIN: '2' });
  await seed(e, ['pogs+saved by the bell', 'pogs+milk caps', 'pogs+zack morris']);
  const calls = [];
  const call = async ({ tool, content }) => {
    calls.push({ tool: tool.name, text: content[0].text });
    if (tool.name === 'organize_tags') {
      return {
        merges: [
          { from: 'milk-caps', to: 'pogs', reason: 'same toy' },
          { from: 'pogs', to: 'saved-by-the-bell' }, // chain: ignored
          { from: 'nope', to: 'pogs' } // unknown: ignored
        ],
        updates: [
          { tag: 'saved-by-the-bell', label: 'Saved by the Bell' },
          { tag: 'zack-morris', category: 'tv-movies' },
          { tag: 'ghost', label: 'x' }
        ]
      };
    }
    return { descriptions: [{ tag: 'pogs', description: 'Slammers, kini and the schoolyard economy of 1994.' }, { tag: 'zzz', description: 'x' }] };
  };
  const summary = await runTagUpkeep(e, { call });
  assert.deepEqual(summary.merged.map((m) => [m.from, m.to]), [['milk-caps', 'pogs']]);
  assert.equal(summary.updated, 2);
  assert.equal(summary.described, 1);
  assert.match(calls[0].text, /milk-caps \| MILK CAPS \| tv-movies \| 1 \| NEW/);
  assert.match(calls[1].text, /pogs \(POGS, toys\): /);
  const tag = e.DB.raw.prepare("SELECT label, description FROM xm_tag WHERE tag='saved-by-the-bell'").get();
  assert.equal(tag.label, 'Saved by the Bell');

  // Nothing new: no organize call; pogs already described.
  const again = [];
  await runTagUpkeep(e, { call: async (a) => (again.push(a.tool.name), { merges: [], updates: [], descriptions: [] }) });
  assert.deepEqual(again, []);

  // Automerge off: labels still fixed, merges skipped.
  await seed(e, ['pog slammers']);
  const off = await runTagUpkeep(
    { ...e, TAG_AUTOMERGE: 'false' },
    { call: async () => ({ merges: [{ from: 'pog-slammers', to: 'pogs' }], updates: [], descriptions: [] }) }
  );
  assert.deepEqual(off.merged, []);
});

/* ---- pages and admin ---------------------------------------------------- */

test('topics page, tag page and post page show the vocabulary', async () => {
  const e = env();
  await seed(e, ['pogs+saved by the bell', 'pogs+saved by the bell', 'pogs+tamagotchi']);
  await e.DB.raw.prepare("UPDATE xm_tag SET description = 'Slam it.' WHERE tag = 'pogs'").run();
  const deps = { verifySession: fakeVerify };

  const topics = await (await handleSite(request('/tags'), e, deps)).text();
  assert.match(topics, /<section class="topic-group" id="toys"/);
  assert.match(topics, /<li class="w3" data-topic="pogs pogs"><a href="\/tag\/pogs">POGS<\/a> <span class="n">3<\/span>/);
  assert.ok(topics.indexOf('id="tv-movies"') < topics.indexOf('id="toys"'), 'categories in fixed order');

  const tagHtml = await (await handleSite(request('/tag/pogs'), e, deps)).text();
  assert.match(tagHtml, /<h1 class="page-title">POGS<\/h1>/);
  assert.match(tagHtml, /<p class="tag-intro">Slam it.<\/p>/);
  assert.match(tagHtml, /<meta name="description" content="Slam it.">/);
  assert.match(tagHtml, /aria-label="Often tagged with POGS"/);
  assert.match(tagHtml, /"@type":"CollectionPage"/);

  const slug = e.DB.raw.prepare("SELECT slug FROM xm_post ORDER BY id LIMIT 1").get().slug;
  const post = await (await handleSite(request(`/p/${slug}`), e, deps)).text();
  assert.match(post, /<h2 id="related-h">More like this<\/h2>/);
  assert.match(post, />SAVED BY THE BELL<\/a>/);
});

test('admin tag endpoints: edit, merge, upkeep', async () => {
  const e = env();
  await seed(e, ['pogs+milk caps']);
  const deps = { verifySession: fakeVerify, runTagUpkeep: async () => ({ ran: true }) };
  const admin = { authorization: 'Bearer e9key_admin' };
  const call = (path, body, headers = admin) => handleSite(request(path, { method: 'POST', body, headers }), e, deps);

  assert.equal((await call('/api/site/admin/tags/pogs', { label: 'Pogs' }, {})).status, 403);
  let res = await call('/api/site/admin/tags/pogs', { label: 'Pogs', category: 'toys', description: 'Slammers.' });
  assert.deepEqual(await res.json(), { tag: 'pogs', label: 'Pogs', category: 'toys', description: 'Slammers.' });
  assert.equal((await call('/api/site/admin/tags/pogs', { category: 'bogus' })).status, 400);
  assert.equal((await call('/api/site/admin/tags/missing', { label: 'x' })).status, 404);

  res = await call('/api/site/admin/tags/merge', { from: 'milk-caps', to: 'pogs' });
  assert.deepEqual(await res.json(), { from: 'milk-caps', to: 'pogs', posts: 1 });
  assert.equal((await call('/api/site/admin/tags/merge', { from: 'milk-caps', to: 'pogs' })).status, 400);

  assert.deepEqual(await (await call('/api/site/admin/tags/upkeep')).json(), { ran: true });
});
