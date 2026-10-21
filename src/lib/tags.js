/**
 * The tag vocabulary: categories, matching new tags to existing ones, and the
 * queries behind tag pages, the topics index, related tags and related posts.
 *
 * Tags are slugs ("saved-by-the-bell"). xm_tag gives each a label, a category
 * and a description; xm_tag_alias maps retired slugs to the tag they became.
 */
import { normalizeTag, parseTags } from './util.js';
import { clearState, getState, setState } from './db.js';

/** Fixed categories, in the order the topics page shows them. */
export const CATEGORIES = [
  { id: 'tv-movies', label: 'TV & movies' },
  { id: 'music', label: 'Music' },
  { id: 'games', label: 'Games' },
  { id: 'toys', label: 'Toys & collectibles' },
  { id: 'tech', label: 'Tech & the internet' },
  { id: 'school', label: 'School days' },
  { id: 'food', label: 'Food & drink' },
  { id: 'style', label: 'Fashion & style' },
  { id: 'family', label: 'Home & family' },
  { id: 'adulting', label: 'Adulting' },
  { id: 'other', label: 'Everything else' }
];
export const CATEGORY_IDS = CATEGORIES.map((c) => c.id);
export const categoryLabel = (id) => CATEGORIES.find((c) => c.id === id)?.label || 'Everything else';
export const normalizeCategory = (id) => (CATEGORY_IDS.includes(id) ? id : 'other');

/* ---- matching ------------------------------------------------------------ */

const NUMBER_WORDS = { seventies: '70s', eighties: '80s', nineties: '90s', aughts: '2000s', noughties: '2000s' };
const DROP = new Set(['and', 'the', 'of', 'a']);

/**
 * A loose key under which spelling variants collide: "1990s" and "90s",
 * "video-games" and "videogame", "the-simpsons" and "simpsons".
 */
export function tagKey(slug) {
  return String(slug)
    .split('-')
    .filter((w) => w && !DROP.has(w))
    .map((w) => NUMBER_WORDS[w] || w)
    .map((w) => w.replace(/^(19|20)(\d0s)$/, (_, c, d) => (c === '19' ? d : `${c}${d}`)))
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !/^\d/.test(w) ? w.slice(0, -1) : w))
    .join('');
}

function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1));
      last = tmp;
    }
  }
  return prev[b.length];
}

/**
 * Build a matcher over the current vocabulary.
 * @param {Array<{tag: string}>} tags
 * @param {Map<string,string>} aliases  alias slug -> tag slug
 */
export function createMatcher(tags, aliases = new Map()) {
  const bySlug = new Set(tags.map((t) => t.tag));
  const byKey = new Map();
  for (const t of tags) if (!byKey.has(tagKey(t.tag))) byKey.set(tagKey(t.tag), t.tag);
  const keys = [...byKey.keys()];

  /** @returns {string|null} the existing tag this slug should be, or null if it is new */
  return function match(slug) {
    if (bySlug.has(slug)) return slug;
    if (aliases.has(slug)) return aliases.get(slug);
    const key = tagKey(slug);
    if (byKey.has(key)) return byKey.get(key);
    if (key.length >= 6) {
      const near = keys.find((k) => k.length >= 6 && editDistance(k, key) <= 1);
      if (near) return byKey.get(near);
    }
    return null;
  };
}

/**
 * Turn the tags Claude suggested into vocabulary tags: reuse an existing tag
 * whenever one matches, and keep at most `max` distinct tags.
 * @param {Array<{tag?: string, label?: string, category?: string}|string>} suggested
 * @returns {{ tags: string[], created: Array<{tag, label, category}> }}
 */
export function resolveTags(suggested, match, { max = 6 } = {}) {
  const tags = [];
  const created = [];
  for (const raw of suggested || []) {
    const item = typeof raw === 'string' ? { tag: raw } : raw || {};
    const slug = normalizeTag(item.tag || item.label);
    if (!slug) continue;
    const existing = match(slug);
    const tag = existing || slug;
    if (tags.includes(tag)) continue;
    tags.push(tag);
    if (!existing && !created.some((c) => c.tag === tag)) {
      created.push({
        tag,
        label: String(item.label || slug.replace(/-/g, ' ')).trim().slice(0, 60),
        category: normalizeCategory(item.category)
      });
    }
    if (tags.length >= max) break;
  }
  return { tags, created: created.filter((c) => tags.includes(c.tag)) };
}

/* ---- queries --------------------------------------------------------------- */

const PUBLISHED_COUNT = `(SELECT COUNT(*) FROM xm_post_tag pt JOIN xm_post p ON p.id = pt.post_id
                          WHERE pt.tag = t.tag AND p.status = 'published')`;

/** Every tag with its published post count, most used first. */
export async function vocabulary(db) {
  const { results } = await db
    .prepare(
      `SELECT t.tag, t.label, t.category, t.description, t.reviewed_at, ${PUBLISHED_COUNT} AS n
         FROM xm_tag t ORDER BY n DESC, t.tag`
    )
    .all();
  return results;
}

export async function aliasMap(db) {
  const { results } = await db.prepare('SELECT alias, tag FROM xm_tag_alias').all();
  return new Map(results.map((r) => [r.alias, r.tag]));
}

export async function addTags(db, tags) {
  if (!tags.length) return;
  await db.batch(
    tags.map((t) =>
      db
        .prepare('INSERT OR IGNORE INTO xm_tag (tag, label, category) VALUES (?, ?, ?)')
        .bind(t.tag, t.label || t.tag.replace(/-/g, ' '), normalizeCategory(t.category))
    )
  );
}

/** Forget the cached tag counts; the next page view rebuilds them. */
export function invalidateTagCounts(db) {
  return clearState(db, 'tags_used');
}

/**
 * Tags with at least one published post, most used first, for the topic
 * row, the Topics page and the sitemap. Counting touches every tag link, so
 * the result is kept in xm_state and rebuilt only after posts or tags change:
 * a page view then reads one row instead of thousands.
 */
export async function usedTags(db, { limit = 500 } = {}) {
  const cached = await getState(db, 'tags_used');
  let all = null;
  if (cached) {
    try {
      all = JSON.parse(cached);
    } catch {
      all = null;
    }
  }
  if (!all) {
    const { results } = await db
      .prepare(
        `SELECT * FROM (SELECT t.tag, t.label, t.category, ${PUBLISHED_COUNT} AS n FROM xm_tag t)
          WHERE n > 0 ORDER BY n DESC, tag`
      )
      .all();
    all = results.map((r) => ({ tag: r.tag, label: r.label, category: r.category, n: r.n }));
    await setState(db, 'tags_used', JSON.stringify(all));
  }
  return all.slice(0, limit);
}

export async function getTag(db, slug) {
  return db.prepare('SELECT tag, label, category, description FROM xm_tag WHERE tag = ?').bind(slug).first();
}

export async function resolveAlias(db, slug) {
  const row = await db.prepare('SELECT tag FROM xm_tag_alias WHERE alias = ?').bind(slug).first();
  return row?.tag || null;
}

/** Label and category for each of a post's tag slugs, in the post's order. */
export async function tagDetails(db, slugs) {
  if (!slugs.length) return [];
  const { results } = await db
    .prepare(`SELECT tag, label, category FROM xm_tag WHERE tag IN (${slugs.map(() => '?').join(',')})`)
    .bind(...slugs)
    .all();
  const map = new Map(results.map((r) => [r.tag, r]));
  return slugs.map((s) => map.get(s) || { tag: s, label: s.replace(/-/g, ' '), category: 'other' });
}

/** Tags that most often appear on the same posts as `tag`. */
export async function relatedTags(db, tag, limit = 8) {
  const { results } = await db
    .prepare(
      `SELECT t.tag, t.label, t.category, COUNT(*) AS n
         FROM xm_post_tag a
         JOIN xm_post_tag b ON b.post_id = a.post_id AND b.tag <> a.tag
         JOIN xm_post p ON p.id = a.post_id AND p.status = 'published'
         JOIN xm_tag t ON t.tag = b.tag
        WHERE a.tag = ?
        GROUP BY t.tag ORDER BY n DESC, t.tag LIMIT ?`
    )
    .bind(tag, limit)
    .all();
  return results;
}

/**
 * Posts sharing the most tags with `postId`. Rarer shared tags count for
 * more, so two memes about the same show outrank two that are merely "90s".
 */
export async function relatedPosts(db, postId, limit = 6) {
  // CROSS JOIN fixes the join order: start from this post's tags, then their
  // posts, then each post by id. Left to itself SQLite walked every
  // published post first.
  const { results } = await db
    .prepare(
      `WITH mine AS (SELECT tag FROM xm_post_tag WHERE post_id = ?),
            weight AS (
              SELECT pt.tag, 1.0 / COUNT(*) AS w FROM xm_post_tag pt
               WHERE pt.tag IN (SELECT tag FROM mine) GROUP BY pt.tag)
       SELECT p.id, p.slug, p.title, p.alt_text, p.image_key, p.thumb_key, p.width, p.height, SUM(weight.w) AS score
         FROM weight
         CROSS JOIN xm_post_tag pt ON pt.tag = weight.tag
         CROSS JOIN xm_post p ON p.id = pt.post_id
        WHERE pt.post_id <> ? AND p.status = 'published'
        GROUP BY p.id ORDER BY score DESC, p.id DESC LIMIT ?`
    )
    .bind(postId, postId, limit)
    .all();
  return results;
}

export async function updateTag(db, tag, { label, category, description, reviewed = false }) {
  const sets = [];
  const args = [];
  if (label) {
    sets.push('label = ?');
    args.push(String(label).slice(0, 60));
  }
  if (category) {
    sets.push('category = ?');
    args.push(normalizeCategory(category));
  }
  if (description !== undefined) {
    sets.push('description = ?');
    args.push(description ? String(description).slice(0, 400) : null);
  }
  if (reviewed) sets.push("reviewed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')");
  if (!sets.length) return;
  await db.prepare(`UPDATE xm_tag SET ${sets.join(', ')} WHERE tag = ?`).bind(...args, tag).run();
  if (label || category) await invalidateTagCounts(db);
}

/**
 * Fold tag `from` into tag `to`: move its posts, keep its slug as an alias
 * (so /tag/<from> redirects), and delete it. Returns the number of posts moved.
 */
export async function mergeTag(db, from, to, reason = 'auto-merge') {
  if (!from || !to || from === to) return 0;
  const target = await getTag(db, to);
  if (!target) throw new Error(`cannot merge into unknown tag ${to}`);
  const { results } = await db.prepare('SELECT post_id FROM xm_post_tag WHERE tag = ?').bind(from).all();
  const postIds = results.map((r) => r.post_id);

  const statements = [
    db.prepare('INSERT OR IGNORE INTO xm_post_tag (post_id, tag) SELECT post_id, ? FROM xm_post_tag WHERE tag = ?').bind(to, from),
    db.prepare('DELETE FROM xm_post_tag WHERE tag = ?').bind(from),
    db.prepare('UPDATE xm_tag_alias SET tag = ? WHERE tag = ?').bind(to, from),
    db.prepare('INSERT OR REPLACE INTO xm_tag_alias (alias, tag, reason) VALUES (?, ?, ?)').bind(from, to, reason),
    db.prepare('DELETE FROM xm_tag WHERE tag = ?').bind(from)
  ];
  // Keep the denormalized xm_post.tags JSON in step.
  if (postIds.length) {
    const { results: posts } = await db
      .prepare(`SELECT id, tags FROM xm_post WHERE id IN (${postIds.map(() => '?').join(',')})`)
      .bind(...postIds)
      .all();
    for (const p of posts) {
      const next = [...new Set(parseTags(p.tags).map((t) => (t === from ? to : t)))];
      statements.push(db.prepare('UPDATE xm_post SET tags = ? WHERE id = ?').bind(JSON.stringify(next), p.id));
    }
  }
  await db.batch(statements);
  await invalidateTagCounts(db);
  return postIds.length;
}
