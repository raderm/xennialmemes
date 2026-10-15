/**
 * Page routes. Kept separate from worker.js (which wires up engine9 core) so
 * tests can run them against a plain SQLite database.
 */
import * as data from '../lib/db.js';
import { handleSiteApi } from './api.js';
import {
  favoritesPage,
  homePage,
  notFoundPage,
  postPage,
  robotsTxt,
  rssXml,
  sitemapXml,
  tagPage
} from './render.js';

const HTML = { 'content-type': 'text/html; charset=utf-8' };
// Pages are cached briefly at the edge; new memes show up within a minute.
const PAGE_CACHE = 'public, max-age=60, stale-while-revalidate=300';

function html(body, status = 200, cache = PAGE_CACHE) {
  return new Response(body, { status, headers: { ...HTML, 'cache-control': cache } });
}

async function serveImage(env, key, request) {
  if (!key || key.includes('..')) return null;
  const object = await env.MEDIA.get(key, { onlyIf: request.headers, range: request.headers });
  if (!object) return null;
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  if (!headers.has('cache-control')) headers.set('cache-control', 'public, max-age=31536000, immutable');
  headers.set('x-content-type-options', 'nosniff');
  // R2 returns an object without a body when the conditional request matched.
  if (!('body' in object) || !object.body) return new Response(null, { status: 304, headers });
  return new Response(object.body, { headers });
}

/**
 * @returns {Promise<Response|null>} null when the request is not a site route
 * (engine9 core's /api and static assets handle the rest).
 */
export async function handleSite(request, env, deps) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (path.startsWith('/api/site/')) return handleSiteApi(request, env, deps);
  if (method !== 'GET' && method !== 'HEAD') return null;

  // Redirect www to the bare domain so search engines see one site.
  if (url.hostname.startsWith('www.')) {
    url.hostname = url.hostname.slice(4);
    return Response.redirect(url.toString(), 301);
  }

  const db = env.DB;

  if (path.startsWith('/i/')) {
    return (await serveImage(env, decodeURIComponent(path.slice(3)), request)) || html(notFoundPage(env), 404);
  }

  if (path === '/') {
    const before = url.searchParams.get('before');
    const [{ posts, next }, tags] = await Promise.all([data.listPosts(db, { before }), data.topTags(db, 24)]);
    return html(homePage(env, { posts, next, tags, before }));
  }

  const tagMatch = path.match(/^\/tag\/([^/]+)\/?$/);
  if (tagMatch) {
    const tag = decodeURIComponent(tagMatch[1]).toLowerCase();
    const before = url.searchParams.get('before');
    const [{ posts, next }, tags] = await Promise.all([data.listPosts(db, { tag, before }), data.topTags(db, 24)]);
    if (!posts.length && !before) return html(notFoundPage(env), 404);
    return html(tagPage(env, { tag, posts, next, tags, before }));
  }

  const postMatch = path.match(/^\/p\/([a-z0-9-]+)\/?$/);
  if (postMatch) {
    const post = await data.getPostBySlug(db, postMatch[1]);
    if (!post) return html(notFoundPage(env), 404);
    const [comments, near] = await Promise.all([data.listComments(db, post.id), data.neighbours(db, post.id)]);
    return html(postPage(env, { post, comments, neighbours: near }));
  }

  if (path === '/favorites') return html(favoritesPage(env), 200, 'no-store');

  if (path === '/sitemap.xml') {
    const [rows, tags] = await Promise.all([data.allSlugs(db), data.topTags(db, 500)]);
    return new Response(sitemapXml(env, rows, tags), {
      headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=600' }
    });
  }

  if (path === '/robots.txt') {
    return new Response(robotsTxt(env), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }

  if (path === '/feed.xml') {
    const { posts } = await data.listPosts(db, { limit: 30 });
    return new Response(rssXml(env, posts), {
      headers: { 'content-type': 'application/rss+xml; charset=utf-8', 'cache-control': 'public, max-age=300' }
    });
  }

  return null;
}

export function notFound(env) {
  return html(notFoundPage(env), 404);
}
