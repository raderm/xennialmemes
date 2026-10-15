/**
 * The site's own JSON API, mounted at /api/site/* in front of engine9 core.
 *
 * Members are engine9 people. The browser logs in with @engine9/id, core's
 * POST /api/auth/login turns the Identity Token into a Core Session, and
 * @engine9/id sends that session on every call as X-Engine9-Session. Here we
 * only check its HMAC (verifySession), so no call reaches the identity
 * provider. Because the session travels in a header, not a cookie, these
 * routes are not exposed to cross-site request forgery.
 */
import * as data from '../lib/db.js';
import { json, safeEqual } from '../lib/util.js';
import { postCard } from './render.js';

const HANDLE_RE = /^[a-z0-9_]{3,24}$/i;
const COMMENT_MAX = 1000;
const COMMENTS_PER_10_MIN = 10;

export function adminEmails(env) {
  return String(env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

function sessionFrom(request, verifySession) {
  const token = request.headers.get('x-engine9-session');
  if (!token) return null;
  const session = verifySession(token);
  return session && Number.isInteger(session.personId) ? session : null;
}

function isAdminSession(session, env) {
  return !!session?.email && adminEmails(env).includes(String(session.email).toLowerCase());
}

function hasAdminKey(request, env) {
  const header = request.headers.get('authorization') || '';
  const key = header.startsWith('Bearer ') ? header.slice(7).trim() : request.headers.get('x-admin-key');
  return !!env.E9_ADMIN_API_KEY && !!key && safeEqual(key, env.E9_ADMIN_API_KEY);
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

/**
 * @param {Request} request
 * @param {object} env  Worker env (DB, ADMIN_EMAILS, E9_ADMIN_API_KEY, ...)
 * @param {object} deps { verifySession(token) -> session|null, runIngest(env) -> summary }
 * @returns {Promise<Response|null>} null when the path is not a site route
 */
export async function handleSiteApi(request, env, deps) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/site/, '') || '/';
  const method = request.method.toUpperCase();
  const db = env.DB;
  const session = sessionFrom(request, deps.verifySession);
  const isAdmin = isAdminSession(session, env);
  const needSession = () => json(401, { error: 'Log in first.' });

  // GET /api/site/posts?before=<id>&tag=<tag>  — the infinite-scroll feed.
  if (method === 'GET' && path === '/posts') {
    const tag = url.searchParams.get('tag') || null;
    const { posts, next } = await data.listPosts(db, { before: url.searchParams.get('before'), tag });
    return json(200, { html: posts.map((p) => postCard(p)).join(''), next, count: posts.length }, {
      'cache-control': 'public, max-age=60'
    });
  }

  // GET /api/site/me — who is logged in, their handle and favorites.
  if (method === 'GET' && path === '/me') {
    if (!session) return needSession();
    const profile = await data.getProfile(db, session.personId);
    return json(200, {
      personId: session.personId,
      handle: profile?.handle || null,
      isAdmin,
      favorites: await data.favoriteIds(db, session.personId)
    });
  }

  // POST /api/site/profile { handle }
  if (method === 'POST' && path === '/profile') {
    if (!session) return needSession();
    const handle = String((await readJson(request)).handle || '').trim();
    if (!HANDLE_RE.test(handle)) {
      return json(400, { error: 'Handles are 3-24 letters, numbers or underscores.' });
    }
    const result = await data.setHandle(db, session.personId, handle);
    if (result.error === 'taken') return json(409, { error: 'That handle is taken. Try another.' });
    return json(200, { handle });
  }

  // GET /api/site/favorites — the member's saved posts as grid cards.
  if (method === 'GET' && path === '/favorites') {
    if (!session) return needSession();
    const posts = await data.listFavoritePosts(db, session.personId);
    return json(200, { html: posts.map((p) => postCard(p)).join(''), count: posts.length });
  }

  // POST /api/site/favorites { post_id } — toggles.
  if (method === 'POST' && path === '/favorites') {
    if (!session) return needSession();
    const postId = Number((await readJson(request)).post_id);
    const post = Number.isInteger(postId) ? await data.getPostById(db, postId) : null;
    if (!post || post.status !== 'published') return json(404, { error: 'No such post.' });
    return json(200, await data.toggleFavorite(db, session.personId, postId));
  }

  // GET /api/site/comments?post_id=
  if (method === 'GET' && path === '/comments') {
    const postId = Number(url.searchParams.get('post_id'));
    if (!Number.isInteger(postId)) return json(400, { error: 'post_id is required' });
    const comments = await data.listComments(db, postId);
    return json(200, {
      comments: comments.map((c) => ({
        id: c.id,
        handle: c.handle,
        body: c.body,
        created_at: c.created_at,
        mine: session ? c.person_id === session.personId : false
      }))
    });
  }

  // POST /api/site/comments { post_id, body }
  if (method === 'POST' && path === '/comments') {
    if (!session) return needSession();
    const profile = await data.getProfile(db, session.personId);
    if (!profile) return json(409, { error: 'Pick a handle before commenting.', needsHandle: true });
    const input = await readJson(request);
    const postId = Number(input.post_id);
    const body = String(input.body || '').replace(/\r\n/g, '\n').trim();
    if (!body) return json(400, { error: 'Write something first.' });
    if (body.length > COMMENT_MAX) return json(400, { error: `Comments are limited to ${COMMENT_MAX} characters.` });
    const post = Number.isInteger(postId) ? await data.getPostById(db, postId) : null;
    if (!post || post.status !== 'published') return json(404, { error: 'No such post.' });
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    if ((await data.recentCommentCount(db, session.personId, since)) >= COMMENTS_PER_10_MIN) {
      return json(429, { error: 'Slow down a little — try again in a few minutes.' });
    }
    const comment = await data.addComment(db, { postId, personId: session.personId, body });
    return json(201, { comment: { id: comment.id, handle: comment.handle, body: comment.body, created_at: comment.created_at, mine: true } });
  }

  // DELETE /api/site/comments/:id — the author or an admin.
  const commentMatch = path.match(/^\/comments\/(\d+)$/);
  if (method === 'DELETE' && commentMatch) {
    if (!session) return needSession();
    const comment = await data.getComment(db, commentMatch[1]);
    if (!comment || comment.status !== 'visible') return json(404, { error: 'No such comment.' });
    if (comment.person_id !== session.personId && !isAdmin) return json(403, { error: 'Not your comment.' });
    await data.deleteComment(db, comment.id);
    return json(200, { deleted: true });
  }

  // POST /api/site/admin/posts/:id { status: "hidden" | "published" }
  const postMatch = path.match(/^\/admin\/posts\/(\d+)$/);
  if (method === 'POST' && postMatch) {
    if (!isAdmin && !hasAdminKey(request, env)) return json(403, { error: 'Admins only.' });
    const status = (await readJson(request)).status;
    if (!['hidden', 'published'].includes(status)) return json(400, { error: 'status must be hidden or published' });
    await data.setPostStatus(db, postMatch[1], status);
    return json(200, { id: Number(postMatch[1]), status });
  }

  // POST /api/site/admin/ingest?limit=n — check Drive now instead of waiting for the cron.
  if (method === 'POST' && path === '/admin/ingest') {
    if (!isAdmin && !hasAdminKey(request, env)) return json(403, { error: 'Admins only.' });
    const limit = url.searchParams.get('limit');
    try {
      return json(200, await deps.runIngest(env, { limit: limit ? Number(limit) : undefined }));
    } catch (err) {
      return json(500, { error: err?.message || String(err) });
    }
  }

  return json(404, { error: 'Not found' });
}
