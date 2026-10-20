import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createD1, createR2, fakePng, fakeVerify, request } from './helpers.js';
import { handleSite } from '../src/site/routes.js';
import { existingSeoName, runIngest, usefulHint } from '../src/ingest/index.js';
import { normalizeCaption, captionImage } from '../src/ingest/caption.js';
import { createAssertion, parseServiceAccount } from '../src/ingest/drive.js';
import { imageSize, slugify, escapeHtml } from '../src/lib/util.js';

/* ---- helpers under test --------------------------------------------------- */

test('slugify makes short keyword file names', () => {
  assert.equal(slugify('You have died of Dysentery! (Oregon Trail)'), 'you-have-died-dysentery-oregon-trail');
  assert.equal(slugify('Café   Ünïcode — test'), 'cafe-unicode-test');
  assert.ok(slugify('word '.repeat(40)).length <= 60);
  assert.equal(slugify('!!!'), '');
});

test('imageSize reads PNG, GIF, JPEG headers', () => {
  assert.deepEqual(imageSize(fakePng(800, 600)), { width: 800, height: 600, mime: 'image/png' });
  const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x20, 0x03, 0x58, 0x02]);
  assert.deepEqual(imageSize(gif), { width: 800, height: 600, mime: 'image/gif' });
  // SOI, APP0 (length 16), SOF0 with height 300 width 400
  const jpg = new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...new Array(14).fill(0),
    0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x01, 0x90, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0
  ]);
  assert.deepEqual(imageSize(jpg), { width: 400, height: 300, mime: 'image/jpeg' });
  assert.equal(imageSize(new Uint8Array([1, 2, 3, 4])), null);
});

test('normalizeCaption cleans model output', () => {
  const c = normalizeCaption({
    title: '  Rewinding   tapes  ',
    alt_text: 'x'.repeat(600),
    description: 'Pencil plus cassette.',
    filename: 'Pencil Rewind Cassette Tape.JPG',
    tags: [
      { tag: 'Mixtapes', label: 'Mixtapes', category: 'music' },
      'mixtapes',
      { tag: '80s Music!', label: '80s music', category: 'nope' },
      'meme',
      '90s',
      '',
      'a',
      'b',
      'c',
      'd'
    ]
  });
  assert.equal(c.title, 'Rewinding tapes');
  assert.ok(c.alt_text.length <= 420);
  assert.equal(c.filename, 'pencil-rewind-cassette-tape-jpg');
  assert.deepEqual(c.tags.slice(0, 2), [
    { tag: 'mixtapes', label: 'Mixtapes', category: 'music' },
    { tag: '80s-music', label: '80s music', category: 'other' }
  ]);
  assert.ok(!c.tags.some((t) => ['meme', '90s'].includes(t.tag)), 'tags that fit every post are dropped');
  assert.ok(c.tags.length <= 6);
});

test('usefulHint ignores camera-style file names', () => {
  assert.equal(usefulHint({ name: 'IMG_2034.jpg' }), '');
  assert.equal(usefulHint({ name: 'Screenshot 2026-10-01 at 9.41.22.png' }), '');
  assert.equal(usefulHint({ name: '20261001_094122.jpg' }), '');
  assert.equal(usefulHint({ name: 'tamagotchi-funeral.png', description: 'RIP' }), 'tamagotchi funeral — RIP');
});

test('captionImage sends the image and reads the structured JSON reply', async () => {
  let sent;
  const reply = {
    title: 'Be kind, rewind',
    alt_text: 'A VHS tape with a sticker reading "Be kind, rewind".',
    description: 'Video store rules.',
    filename: 'be-kind-rewind-vhs-meme',
    tags: [{ tag: 'vhs', label: 'VHS', category: 'tech' }]
  };
  const fetchImpl = async (url, init) => {
    sent = { url, init, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(reply) }] }), { status: 200 });
  };
  const out = await captionImage({ bytes: fakePng(10, 10), mimeType: 'image/png', apiKey: 'k', fetchImpl, hint: 'vhs' });
  assert.equal(sent.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(sent.init.headers['x-api-key'], 'k');
  assert.equal(sent.body.tool_choice, undefined, 'no forced tool call');
  assert.equal(sent.body.tools, undefined);
  const schema = sent.body.output_config.format.schema;
  assert.equal(sent.body.output_config.format.type, 'json_schema');
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.tags.items.additionalProperties, false, 'nested objects are strict too');
  assert.equal(sent.body.messages[0].content[0].type, 'image');
  assert.equal(sent.body.model, 'claude-sonnet-5-5');
  assert.equal(out.filename, 'be-kind-rewind-vhs-meme');
  assert.deepEqual(out.tags, [{ tag: 'vhs', label: 'VHS', category: 'tech' }]);

  const failing = async () => new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 });
  await assert.rejects(captionImage({ bytes: fakePng(1, 1), mimeType: 'image/png', apiKey: 'k', fetchImpl: failing }), /bad key/);
  const refused = async () => new Response(JSON.stringify({ stop_reason: 'refusal', content: [] }));
  await assert.rejects(captionImage({ bytes: fakePng(1, 1), mimeType: 'image/png', apiKey: 'k', fetchImpl: refused }), /declined/);
});

test('service account assertion is a valid RS256 JWT', async () => {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  );
  const pkcs8 = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64');
  const pem = `-----BEGIN PRIVATE KEY-----\n${pkcs8.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;
  const json = JSON.stringify({ client_email: 'bot@proj.iam.gserviceaccount.com', private_key: pem });
  // Accept both raw JSON and base64 JSON.
  const account = parseServiceAccount(Buffer.from(json).toString('base64'));
  const jwt = await createAssertion(account, { now: 1000 });
  const [h, c, s] = jwt.split('.');
  const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
  assert.equal(claims.iss, 'bot@proj.iam.gserviceaccount.com');
  assert.equal(claims.scope, 'https://www.googleapis.com/auth/drive.readonly');
  assert.equal(claims.exp, 4600);
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    pair.publicKey,
    Buffer.from(s, 'base64url'),
    new TextEncoder().encode(`${h}.${c}`)
  );
  assert.ok(ok);
});

/* ---- ingest ----------------------------------------------------------------- */

function fakeDrive(files) {
  return {
    files,
    async listImages() {
      return this.files;
    },
    async download(id) {
      if (id === 'broken') throw new Error('Drive download failed (500)');
      return fakePng(1000, 800);
    }
  };
}

const fakeCaption = async ({ hint }) =>
  normalizeCaption({
    title: `Meme about ${hint || 'nothing'}`,
    alt_text: `Alt for ${hint}`,
    description: 'desc',
    filename: 'dial-up-modem-noise',
    tags: [
      { tag: 'dial-up-internet', label: 'Dial-up internet', category: 'tech' },
      { tag: 'aol', label: 'AOL', category: 'tech' }
    ]
  });

function env(extra = {}) {
  return { DB: createD1(), MEDIA: createR2(), DRIVE_FOLDER_ID: 'folder', INGEST_BATCH: '5', ...extra };
}

test('ingest creates posts with unique SEO file names and skips known files', async () => {
  const e = env();
  const drive = fakeDrive([
    { id: 'a', name: 'dial-up.png', mimeType: 'image/png', size: '64' },
    { id: 'b', name: 'IMG_0001.png', mimeType: 'image/png', size: '64' },
    { id: 'c', name: 'doc.pdf', mimeType: 'application/pdf', size: '64' }
  ]);
  const first = await runIngest(e, { drive, caption: fakeCaption, log: { error() {} } });
  assert.equal(first.created.length, 2);
  assert.deepEqual(first.created.map((c) => c.slug), ['dial-up-modem-noise', 'dial-up-modem-noise-2']);
  assert.ok(e.MEDIA.objects.has('dial-up-modem-noise.png'));
  assert.ok(e.MEDIA.objects.has('dial-up-modem-noise-2.png'));

  const post = e.DB.raw.prepare("SELECT * FROM xm_post WHERE drive_file_id = 'a'").get();
  assert.equal(post.width, 1000);
  assert.equal(post.alt_text, 'Alt for dial up');
  assert.deepEqual(JSON.parse(post.tags), ['dial-up-internet', 'aol']);
  assert.equal(e.DB.raw.prepare("SELECT label FROM xm_tag WHERE tag='aol'").get().label, 'AOL');
  assert.equal(e.DB.raw.prepare('SELECT COUNT(*) AS n FROM xm_post_tag').get().n, 4);

  const second = await runIngest(e, { drive, caption: fakeCaption });
  assert.equal(second.created.length, 0);
});

test('ingest respects the batch size and retries failures at most 3 times', async () => {
  const e = env({ INGEST_BATCH: '1' });
  const drive = fakeDrive([
    { id: 'broken', name: 'x.png', mimeType: 'image/png' },
    { id: 'ok', name: 'y.png', mimeType: 'image/png' }
  ]);
  const quiet = { error() {} };
  const r1 = await runIngest(e, { drive, caption: fakeCaption, log: quiet });
  assert.equal(r1.failed.length, 1);
  assert.equal(r1.pending, 1);
  await runIngest(e, { drive, caption: fakeCaption, log: quiet });
  await runIngest(e, { drive, caption: fakeCaption, log: quiet });
  const r4 = await runIngest(e, { drive, caption: fakeCaption, log: quiet });
  assert.equal(r4.created.length, 1, 'after 3 failures the broken file is skipped');
  assert.equal(e.DB.raw.prepare("SELECT attempts FROM xm_ingest_error WHERE drive_file_id='broken'").get().attempts, 3);
});

test('removing a file from Drive takes the post down, restoring brings it back', async () => {
  const e = env();
  const drive = fakeDrive([
    { id: 'a', name: 'a.png', mimeType: 'image/png' },
    { id: 'b', name: 'b.png', mimeType: 'image/png' }
  ]);
  await runIngest(e, { drive, caption: fakeCaption });
  drive.files = drive.files.slice(1);
  const r = await runIngest(e, { drive, caption: fakeCaption });
  assert.equal(r.removed, 1);
  assert.equal(e.DB.raw.prepare("SELECT status FROM xm_post WHERE drive_file_id='a'").get().status, 'removed');
  // An empty listing (e.g. sharing revoked) must not wipe the site.
  drive.files = [];
  await runIngest(e, { drive, caption: fakeCaption });
  assert.equal(e.DB.raw.prepare("SELECT status FROM xm_post WHERE drive_file_id='b'").get().status, 'published');
  drive.files = [{ id: 'a', name: 'a.png', mimeType: 'image/png' }, { id: 'b', name: 'b.png', mimeType: 'image/png' }];
  await runIngest(e, { drive, caption: fakeCaption });
  assert.equal(e.DB.raw.prepare("SELECT status FROM xm_post WHERE drive_file_id='a'").get().status, 'published');
});

/* ---- pages and API ------------------------------------------------------- */

async function seeded(extra = {}) {
  const e = env({ E9_PUBLIC_API_KEY: 'e9publickey_test', ADMIN_EMAILS: 'Boss@example.com', E9_ADMIN_API_KEY: 'e9key_admin', ...extra });
  const files = Array.from({ length: 35 }, (_, i) => ({ id: `f${i}`, name: `meme-${i}.png`, mimeType: 'image/png' }));
  await runIngest(e, { drive: fakeDrive(files), caption: fakeCaption, limit: 35 });
  return e;
}

const deps = { verifySession: fakeVerify, runIngest: async () => ({ ran: true }) };
const call = (e, path, opts) => handleSite(request(path, opts), e, deps);

test('home page renders the mosaic with alt text, SEO tags and pagination', async () => {
  const e = await seeded();
  const res = await call(e, '/');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.equal((html.match(/class="tile"/g) || []).length, 30);
  assert.match(html, /alt="Alt for meme 34"/);
  assert.match(html, /<link rel="canonical" href="https:\/\/xennialmemes.com\/">/);
  assert.match(html, /"publicKey":"e9publickey_test"/);
  assert.match(html, /<script src="\/assets\/vendor\/engine9-id.js" defer><\/script>/, 'login library served from the site');
  assert.doesNotMatch(html, /unpkg\.com/);
  assert.match(html, /data-load-more/);
  assert.match(html, /href="\/tag\/dial-up-internet">Dial-up internet<\/a>/);
  assert.match(html, /href="\/tags">All topics/);

  const feed = await (await call(e, '/api/site/posts?before=6')).json();
  assert.equal(feed.count, 5);
  assert.equal(feed.next, null);
});

test('post page has meta tags, JSON-LD, and escapes user text', async () => {
  const e = await seeded();
  const slug = e.DB.raw.prepare("SELECT slug FROM xm_post WHERE drive_file_id='f3'").get().slug;
  const html = await (await call(e, `/p/${slug}`)).text();
  assert.match(html, new RegExp(`<title>Meme about meme 3 \\| Xennial Memes</title>`));
  assert.match(html, /property="og:image" content="https:\/\/xennialmemes.com\/i\//);
  assert.match(html, /"@type":"ImageObject"/);
  assert.match(html, /rel="next"/);
  assert.equal((await call(e, '/p/nope')).status, 404);
  assert.equal(escapeHtml('<script>"'), '&lt;script&gt;&quot;');
});

test('sitemap, robots, feed, images, tag pages, www redirect', async () => {
  const e = await seeded();
  const sitemap = await (await call(e, '/sitemap.xml')).text();
  assert.equal((sitemap.match(/<url>/g) || []).length, 1 + 1 + 2 + 35);
  assert.match(sitemap, /<image:loc>https:\/\/xennialmemes.com\/i\/dial-up-modem-noise/);
  assert.match(await (await call(e, '/robots.txt')).text(), /Sitemap: https:\/\/xennialmemes.com\/sitemap.xml/);
  assert.match(await (await call(e, '/feed.xml')).text(), /<rss version="2.0">/);
  const img = await call(e, '/i/dial-up-modem-noise.png');
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.equal((await call(e, '/tag/aol')).status, 200);
  assert.equal((await call(e, '/tag/nothing-here')).status, 404);
  const www = await handleSite(new Request('https://www.xennialmemes.com/p/x?y=1'), e, deps);
  assert.equal(www.status, 301);
  assert.equal(www.headers.get('location'), 'https://xennialmemes.com/p/x?y=1');
  assert.equal(await handleSite(new Request('https://xennialmemes.com/api/ok'), e, deps), null);
});

test('members: handle, favorites, comments, deletes, admin', async () => {
  const e = await seeded();
  const postId = e.DB.raw.prepare("SELECT id FROM xm_post WHERE drive_file_id='f1'").get().id;

  assert.equal((await call(e, '/api/site/me')).status, 401);
  assert.equal((await call(e, '/api/site/me', { session: 'forged' })).status, 401);

  const me = await (await call(e, '/api/site/me', { session: 'person:7' })).json();
  assert.deepEqual(me, { personId: 7, handle: null, isAdmin: false, favorites: [] });

  // Favorites toggle.
  let fav = await (await call(e, '/api/site/favorites', { method: 'POST', session: 'person:7', body: { post_id: postId } })).json();
  assert.deepEqual(fav, { favorited: true, count: 1 });
  await call(e, '/api/site/favorites', { method: 'POST', session: 'person:8', body: { post_id: postId } });
  const favPage = await (await call(e, '/api/site/favorites', { session: 'person:7' })).json();
  assert.equal(favPage.count, 1);
  fav = await (await call(e, '/api/site/favorites', { method: 'POST', session: 'person:7', body: { post_id: postId } })).json();
  assert.deepEqual(fav, { favorited: false, count: 1 });
  assert.equal((await call(e, '/api/site/favorites', { method: 'POST', session: 'person:7', body: { post_id: 99999 } })).status, 404);

  // Commenting needs a handle first.
  let res = await call(e, '/api/site/comments', { method: 'POST', session: 'person:7', body: { post_id: postId, body: 'hi' } });
  assert.equal(res.status, 409);
  assert.equal((await call(e, '/api/site/profile', { method: 'POST', session: 'person:7', body: { handle: 'no spaces' } })).status, 400);
  assert.equal((await call(e, '/api/site/profile', { method: 'POST', session: 'person:7', body: { handle: 'kid_rock_fan' } })).status, 200);
  assert.equal((await call(e, '/api/site/profile', { method: 'POST', session: 'person:8', body: { handle: 'KID_ROCK_FAN' } })).status, 409);

  res = await call(e, '/api/site/comments', {
    method: 'POST',
    session: 'person:7',
    body: { post_id: postId, body: '<b>Remember</b> Geocities?' }
  });
  assert.equal(res.status, 201);
  const { comment } = await res.json();
  assert.equal(comment.handle, 'kid_rock_fan');

  // Rendered escaped on the post page.
  const slug = e.DB.raw.prepare('SELECT slug FROM xm_post WHERE id = ?').get(postId).slug;
  const html = await (await call(e, `/p/${slug}`)).text();
  assert.match(html, /&lt;b&gt;Remember&lt;\/b&gt; Geocities\?/);
  assert.doesNotMatch(html, /<b>Remember/);

  const list = await (await call(e, `/api/site/comments?post_id=${postId}`, { session: 'person:8' })).json();
  assert.equal(list.comments[0].mine, false);

  // Only the author or an admin can delete.
  assert.equal((await call(e, `/api/site/comments/${comment.id}`, { method: 'DELETE', session: 'person:8' })).status, 403);
  assert.equal((await call(e, `/api/site/comments/${comment.id}`, { method: 'DELETE', session: 'admin:1' })).status, 200);
  assert.equal((await call(e, `/api/site/comments?post_id=${postId}`)).status, 200);

  // Validation and rate limit.
  assert.equal(
    (await call(e, '/api/site/comments', { method: 'POST', session: 'person:7', body: { post_id: postId, body: 'x'.repeat(1001) } })).status,
    400
  );
  for (let i = 0; i < 9; i++) {
    await call(e, '/api/site/comments', { method: 'POST', session: 'person:7', body: { post_id: postId, body: `c${i}` } });
  }
  assert.equal(
    (await call(e, '/api/site/comments', { method: 'POST', session: 'person:7', body: { post_id: postId, body: 'one more' } })).status,
    429
  );

  // Admin: hide a post by session or admin key; ingest trigger.
  assert.equal((await call(e, `/api/site/admin/posts/${postId}`, { method: 'POST', session: 'person:7', body: { status: 'hidden' } })).status, 403);
  assert.equal((await call(e, `/api/site/admin/posts/${postId}`, { method: 'POST', session: 'admin:1', body: { status: 'hidden' } })).status, 200);
  assert.equal((await call(e, `/p/${slug}`)).status, 404);
  const ingest = await call(e, '/api/site/admin/ingest', { method: 'POST', headers: { authorization: 'Bearer e9key_admin' } });
  assert.deepEqual(await ingest.json(), { ran: true });
  assert.equal((await call(e, '/api/site/admin/ingest', { method: 'POST', headers: { authorization: 'Bearer wrong' } })).status, 403);
});

/* ---- keeping SEO-friendly Drive names ------------------------------------- */

test('existingSeoName keeps names already in URL form', () => {
  assert.equal(existingSeoName('oregon-trail-dysentery-meme.jpg'), 'oregon-trail-dysentery-meme');
  assert.equal(existingSeoName('Oregon_Trail_Dysentery.PNG'), 'oregon-trail-dysentery');
  assert.equal(existingSeoName('saved-by-the-bell-zack-phone.webp'), 'saved-by-the-bell-zack-phone');
  assert.equal(existingSeoName('y2k-bug-panic-1999.gif'), 'y2k-bug-panic-1999');
  for (const name of [
    'IMG_2034.jpg',
    'Screenshot_2026-10-01-09-41.png',
    'PXL_20261001_094122.jpg',
    'Oregon Trail.jpg',
    'meme.png',
    'dial-up.png',
    '2026-10-01-1234.png',
    'cool!-meme-here.png',
    'a-b-c-d.png',
    `${'word-'.repeat(20)}end.jpg`
  ]) {
    assert.equal(existingSeoName(name), null, name);
  }
});

test('ingest keeps an SEO-friendly Drive name and only suffixes on collision', async () => {
  const e = env();
  const drive = fakeDrive([
    { id: 'a', name: 'tamagotchi-funeral-meme.png', mimeType: 'image/png' },
    { id: 'b', name: 'IMG_0042.png', mimeType: 'image/png' },
    { id: 'c', name: 'Tamagotchi_Funeral_Meme.png', mimeType: 'image/png' }
  ]);
  const r = await runIngest(e, { drive, caption: fakeCaption });
  assert.deepEqual(r.created.map((c) => c.slug), [
    'tamagotchi-funeral-meme',
    'dial-up-modem-noise',
    'tamagotchi-funeral-meme-2'
  ]);
  assert.ok(e.MEDIA.objects.has('tamagotchi-funeral-meme.png'));
});

test('parseServiceAccount forgives common paste slips and explains real problems', () => {
  const key = { client_email: 'bot@x.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\nAAA\n-----END PRIVATE KEY-----\n' };
  const json = JSON.stringify(key);
  const b64 = Buffer.from(json).toString('base64');
  for (const raw of [
    json,
    b64,
    `GOOGLE_SERVICE_ACCOUNT_JSON=${b64}`,
    `"${b64}"`,
    `'${b64}'\n`,
    b64.match(/.{1,76}/g).join('\n'),
    Buffer.from(json).toString('base64url')
  ]) {
    assert.equal(parseServiceAccount(raw).client_email, key.client_email);
  }
  assert.throws(() => parseServiceAccount(''), /empty/);
  assert.throws(() => parseServiceAccount('cat: /home/x/xm-drive-key.b64: No such file'), /neither the key's JSON nor its base64/);
  assert.throws(() => parseServiceAccount(b64.slice(0, 101)), /cut off/);
  assert.throws(() => parseServiceAccount(Buffer.from('{"a":1}').toString('base64')), /client_email/);
});

test('images of removed or hidden memes are not served', async () => {
  const e = env();
  const drive = fakeDrive([
    { id: 'a', name: 'a.png', mimeType: 'image/png' },
    { id: 'b', name: 'b.png', mimeType: 'image/png' }
  ]);
  await runIngest(e, { drive, caption: fakeCaption });
  const keyOf = (id) => e.DB.raw.prepare('SELECT image_key FROM xm_post WHERE drive_file_id = ?').get(id).image_key;
  const deps = { verifySession: fakeVerify };
  const get = (key) => handleSite(request(`/i/${key}`), e, deps);

  const live = await get(keyOf('a'));
  assert.equal(live.status, 200);
  assert.equal(live.headers.get('cache-control'), 'public, max-age=86400');

  // Removed from Drive: the image address stops working.
  drive.files = drive.files.slice(1);
  await runIngest(e, { drive, caption: fakeCaption });
  assert.equal((await get(keyOf('a'))).status, 404);
  assert.ok(e.MEDIA.objects.has(keyOf('a')), 'the file is kept so a restore brings it back');

  // Hidden by an admin: same.
  e.DB.raw.prepare("UPDATE xm_post SET status = 'hidden' WHERE drive_file_id = 'b'").run();
  assert.equal((await get(keyOf('b'))).status, 404);

  // Restored to Drive: served again.
  drive.files = [{ id: 'a', name: 'a.png', mimeType: 'image/png' }, { id: 'b', name: 'b.png', mimeType: 'image/png' }];
  await runIngest(e, { drive, caption: fakeCaption });
  assert.equal((await get(keyOf('a'))).status, 200);

  // Thumbnails follow their post; unknown keys are 404.
  e.DB.raw.prepare("UPDATE xm_post SET thumb_key = 'thumbs/a.webp' WHERE drive_file_id = 'a'").run();
  await e.MEDIA.put('thumbs/a.webp', new Uint8Array([1]), { httpMetadata: { contentType: 'image/webp' } });
  assert.equal((await get('thumbs/a.webp')).status, 200);
  e.DB.raw.prepare("UPDATE xm_post SET status = 'hidden' WHERE drive_file_id = 'a'").run();
  assert.equal((await get('thumbs/a.webp')).status, 404);
  assert.equal((await get('nothing-here.png')).status, 404);
});
