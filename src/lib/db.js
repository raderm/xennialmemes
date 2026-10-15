/**
 * Queries for the site's own xm_ tables. `db` is a D1 binding (or anything
 * with the same prepare/bind/all/first/run/batch shape).
 */
import { parseTags } from './util.js';

export const PAGE_SIZE = 30;

const POST_COLUMNS =
  'p.id, p.slug, p.title, p.alt_text, p.description, p.tags, p.image_key, p.thumb_key, p.mime_type, p.width, p.height, p.created_at';

function shapePost(row) {
  if (!row) return null;
  return { ...row, tags: parseTags(row.tags) };
}

/** Newest published posts, optionally only those with `tag`, older than `before` (a post id). */
export async function listPosts(db, { before = null, tag = null, limit = PAGE_SIZE } = {}) {
  const where = ["p.status = 'published'"];
  const args = [];
  let from = 'xm_post p';
  if (tag) {
    from += ' JOIN xm_post_tag t ON t.post_id = p.id';
    where.push('t.tag = ?');
    args.push(tag);
  }
  if (before) {
    where.push('p.id < ?');
    args.push(Number(before));
  }
  args.push(limit + 1);
  const { results } = await db
    .prepare(`SELECT ${POST_COLUMNS} FROM ${from} WHERE ${where.join(' AND ')} ORDER BY p.id DESC LIMIT ?`)
    .bind(...args)
    .all();
  const posts = results.slice(0, limit).map(shapePost);
  const next = results.length > limit ? posts[posts.length - 1].id : null;
  return { posts, next };
}

export async function getPostBySlug(db, slug) {
  const row = await db
    .prepare(
      `SELECT ${POST_COLUMNS}, (SELECT COUNT(*) FROM xm_favorite f WHERE f.post_id = p.id) AS favorite_count
         FROM xm_post p WHERE p.slug = ? AND p.status = 'published'`
    )
    .bind(slug)
    .first();
  return shapePost(row);
}

export async function getPostById(db, id) {
  return shapePost(
    await db.prepare(`SELECT ${POST_COLUMNS}, p.status FROM xm_post p WHERE p.id = ?`).bind(Number(id)).first()
  );
}

/** The published posts just newer and just older than `id`, for prev/next links. */
export async function neighbours(db, id) {
  const newer = await db
    .prepare("SELECT slug, title FROM xm_post WHERE status = 'published' AND id > ? ORDER BY id ASC LIMIT 1")
    .bind(id)
    .first();
  const older = await db
    .prepare("SELECT slug, title FROM xm_post WHERE status = 'published' AND id < ? ORDER BY id DESC LIMIT 1")
    .bind(id)
    .first();
  return { newer, older };
}

export async function allSlugs(db) {
  const { results } = await db
    .prepare("SELECT slug, image_key, title, created_at FROM xm_post WHERE status = 'published' ORDER BY id DESC LIMIT 50000")
    .all();
  return results;
}

export async function slugExists(db, slug) {
  return !!(await db.prepare('SELECT 1 AS x FROM xm_post WHERE slug = ?').bind(slug).first());
}

/** Insert a post and its tag rows. Returns the new id, or null if the Drive file was already ingested. */
export async function insertPost(db, post) {
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO xm_post
         (slug, title, alt_text, description, tags, image_key, thumb_key, mime_type, width, height, bytes, drive_file_id, drive_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      post.slug,
      post.title,
      post.alt_text,
      post.description || '',
      JSON.stringify(post.tags || []),
      post.image_key,
      post.thumb_key || null,
      post.mime_type,
      post.width ?? null,
      post.height ?? null,
      post.bytes ?? null,
      post.drive_file_id,
      post.drive_name || null
    )
    .run();
  if (!result.meta || !result.meta.changes) return null;
  const id = result.meta.last_row_id;
  if (post.tags?.length) {
    await db.batch(
      post.tags.map((tag) => db.prepare('INSERT OR IGNORE INTO xm_post_tag (post_id, tag) VALUES (?, ?)').bind(id, tag))
    );
  }
  await db.prepare('DELETE FROM xm_ingest_error WHERE drive_file_id = ?').bind(post.drive_file_id).run();
  return id;
}

export async function knownDriveIds(db) {
  const { results } = await db.prepare('SELECT drive_file_id, status FROM xm_post').all();
  return new Map(results.map((r) => [r.drive_file_id, r.status]));
}

export async function ingestErrors(db) {
  const { results } = await db.prepare('SELECT drive_file_id, attempts FROM xm_ingest_error').all();
  return new Map(results.map((r) => [r.drive_file_id, r.attempts]));
}

export async function recordIngestError(db, { driveFileId, driveName, error }) {
  await db
    .prepare(
      `INSERT INTO xm_ingest_error (drive_file_id, drive_name, attempts, last_error) VALUES (?, ?, 1, ?)
       ON CONFLICT (drive_file_id) DO UPDATE SET attempts = attempts + 1, last_error = excluded.last_error,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
    )
    .bind(driveFileId, driveName || null, String(error).slice(0, 1000))
    .run();
}

/** Hide posts whose Drive file is gone; re-publish ones that came back. Admin-hidden posts stay hidden. */
export async function syncDriveRemovals(db, presentIds) {
  const present = new Set(presentIds);
  const { results } = await db.prepare('SELECT id, drive_file_id, status FROM xm_post').all();
  const statements = [];
  for (const row of results) {
    if (row.status === 'published' && !present.has(row.drive_file_id)) {
      statements.push(db.prepare("UPDATE xm_post SET status = 'removed' WHERE id = ?").bind(row.id));
    } else if (row.status === 'removed' && present.has(row.drive_file_id)) {
      statements.push(db.prepare("UPDATE xm_post SET status = 'published' WHERE id = ?").bind(row.id));
    }
  }
  if (statements.length) await db.batch(statements);
  return statements.length;
}

export async function setPostStatus(db, id, status) {
  await db.prepare('UPDATE xm_post SET status = ? WHERE id = ?').bind(status, Number(id)).run();
}

/* ---- members ------------------------------------------------------------ */

export async function getProfile(db, personId) {
  return db.prepare('SELECT person_id, handle FROM xm_profile WHERE person_id = ?').bind(personId).first();
}

/** Set or change a handle. Returns { ok } or { error: 'taken' }. */
export async function setHandle(db, personId, handle) {
  const owner = await db.prepare('SELECT person_id FROM xm_profile WHERE handle = ?').bind(handle).first();
  if (owner && owner.person_id !== personId) return { error: 'taken' };
  await db
    .prepare(
      'INSERT INTO xm_profile (person_id, handle) VALUES (?, ?) ON CONFLICT (person_id) DO UPDATE SET handle = excluded.handle'
    )
    .bind(personId, handle)
    .run();
  return { ok: true };
}

export async function favoriteIds(db, personId) {
  const { results } = await db.prepare('SELECT post_id FROM xm_favorite WHERE person_id = ?').bind(personId).all();
  return results.map((r) => r.post_id);
}

export async function toggleFavorite(db, personId, postId) {
  const existing = await db
    .prepare('SELECT 1 AS x FROM xm_favorite WHERE person_id = ? AND post_id = ?')
    .bind(personId, postId)
    .first();
  if (existing) {
    await db.prepare('DELETE FROM xm_favorite WHERE person_id = ? AND post_id = ?').bind(personId, postId).run();
  } else {
    await db.prepare('INSERT OR IGNORE INTO xm_favorite (person_id, post_id) VALUES (?, ?)').bind(personId, postId).run();
  }
  const count = await db.prepare('SELECT COUNT(*) AS n FROM xm_favorite WHERE post_id = ?').bind(postId).first();
  return { favorited: !existing, count: count.n };
}

export async function listFavoritePosts(db, personId) {
  const { results } = await db
    .prepare(
      `SELECT ${POST_COLUMNS} FROM xm_favorite f JOIN xm_post p ON p.id = f.post_id
        WHERE f.person_id = ? AND p.status = 'published' ORDER BY f.created_at DESC LIMIT 500`
    )
    .bind(personId)
    .all();
  return results.map(shapePost);
}

export async function listComments(db, postId) {
  const { results } = await db
    .prepare(
      `SELECT c.id, c.person_id, c.body, c.created_at, COALESCE(pr.handle, 'member') AS handle
         FROM xm_comment c LEFT JOIN xm_profile pr ON pr.person_id = c.person_id
        WHERE c.post_id = ? AND c.status = 'visible' ORDER BY c.id ASC LIMIT 500`
    )
    .bind(postId)
    .all();
  return results;
}

export async function recentCommentCount(db, personId, sinceIso) {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM xm_comment WHERE person_id = ? AND created_at > ?')
    .bind(personId, sinceIso)
    .first();
  return row.n;
}

export async function addComment(db, { postId, personId, body }) {
  const result = await db
    .prepare('INSERT INTO xm_comment (post_id, person_id, body) VALUES (?, ?, ?)')
    .bind(postId, personId, body)
    .run();
  return db
    .prepare(
      `SELECT c.id, c.person_id, c.body, c.created_at, COALESCE(pr.handle, 'member') AS handle
         FROM xm_comment c LEFT JOIN xm_profile pr ON pr.person_id = c.person_id WHERE c.id = ?`
    )
    .bind(result.meta.last_row_id)
    .first();
}

export async function getComment(db, id) {
  return db.prepare('SELECT id, post_id, person_id, status FROM xm_comment WHERE id = ?').bind(Number(id)).first();
}

export async function deleteComment(db, id) {
  await db.prepare("UPDATE xm_comment SET status = 'deleted' WHERE id = ?").bind(Number(id)).run();
}
