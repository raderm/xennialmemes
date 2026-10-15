/** Server-rendered HTML for every page. Plain template strings; no framework. */
import { escapeHtml as e } from '../lib/util.js';

export function siteConfig(env) {
  return {
    url: String(env.SITE_URL || 'https://xennialmemes.com').replace(/\/$/, ''),
    name: env.SITE_NAME || 'Xennial Memes',
    tagline: env.SITE_TAGLINE || 'Memes for the analog childhood, digital adulthood generation.',
    publicKey: env.E9_PUBLIC_API_KEY || ''
  };
}

export const imageUrl = (post) => `/i/${post.image_key}`;
export const thumbUrl = (post) => `/i/${post.thumb_key || post.image_key}`;

function thumbSize(post) {
  if (!post.width || !post.height) return { w: 640, h: 640 };
  if (!post.thumb_key) return { w: post.width, h: post.height };
  return { w: 640, h: Math.round((640 * post.height) / post.width) };
}

/** One tile in the mosaic. Also returned by /api/site/posts for infinite scroll. */
export function postCard(post) {
  const { w, h } = thumbSize(post);
  return `<a class="tile" href="/p/${e(post.slug)}" data-id="${post.id}" style="--ar:${w}/${h}">
  <img src="${e(thumbUrl(post))}" alt="${e(post.alt_text)}" width="${w}" height="${h}" loading="lazy" decoding="async">
  <span class="tile-title" aria-hidden="true">${e(post.title)}</span>
</a>`;
}

const SQUIGGLE = `<svg class="band" aria-hidden="true" focusable="false" preserveAspectRatio="none" viewBox="0 0 1200 28">
  <defs>
    <pattern id="sq" width="120" height="28" patternUnits="userSpaceOnUse">
      <path d="M-4 18 C 12 4, 26 4, 40 16 S 70 28, 86 12 S 112 2, 124 14" fill="none" stroke="var(--teal)" stroke-width="7" stroke-linecap="round"/>
      <path d="M8 6 q 6 -5 12 0 t 12 0 t 12 0" fill="none" stroke="var(--grape)" stroke-width="2.5" stroke-linecap="round"/>
      <path d="M70 24 q 5 -4 10 0 t 10 0" fill="none" stroke="var(--grape)" stroke-width="2.5" stroke-linecap="round"/>
      <circle cx="104" cy="24" r="2.2" fill="var(--ink)"/>
      <circle cx="58" cy="5" r="1.8" fill="var(--ink)"/>
    </pattern>
  </defs>
  <rect width="1200" height="28" fill="url(#sq)"/>
</svg>`;

/** The page shell: head, masthead, footer, scripts. */
export function layout(env, { title, description, path = '/', image, imageAlt, jsonLd, body, noindex = false, page = '' }) {
  const site = siteConfig(env);
  const canonical = `${site.url}${path}`;
  const fullTitle = title ? `${title} | ${site.name}` : `${site.name}: ${site.tagline}`;
  const desc = description || site.tagline;
  const ogImage = image ? `${site.url}${image}` : `${site.url}/assets/og-default.png`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(fullTitle)}</title>
<meta name="description" content="${e(desc)}">
<link rel="canonical" href="${e(canonical)}">
${noindex ? '<meta name="robots" content="noindex">' : ''}
<meta property="og:site_name" content="${e(site.name)}">
<meta property="og:type" content="${image ? 'article' : 'website'}">
<meta property="og:title" content="${e(title || site.name)}">
<meta property="og:description" content="${e(desc)}">
<meta property="og:url" content="${e(canonical)}">
<meta property="og:image" content="${e(ogImage)}">
${imageAlt ? `<meta property="og:image:alt" content="${e(imageAlt)}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#1D1F2B">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="alternate" type="application/rss+xml" title="${e(site.name)}" href="/feed.xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@112..125,700..900&family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400&display=swap">
<link rel="stylesheet" href="/assets/site.css">
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>` : ''}
</head>
<body data-page="${e(page)}">
<a class="skip" href="#main">Skip to the memes</a>
<header class="masthead">
  <div class="masthead-row">
    <a class="wordmark" href="/" aria-label="${e(site.name)} home">${e(site.name)}</a>
    <nav class="nav" aria-label="Site">
      <a href="/favorites" class="nav-favs" hidden>Your favorites</a>
      <span data-e9-login-widget></span>
    </nav>
  </div>
  ${SQUIGGLE}
</header>
<main id="main">
${body}
</main>
<footer class="footer">
  <p>${e(site.name)}. New memes land here as soon as they're added. <a href="/feed.xml">RSS feed</a></p>
</footer>
<script>window.XM = ${JSON.stringify({ publicKey: site.publicKey, siteName: site.name }).replace(/</g, '\\u003c')};</script>
<script src="https://unpkg.com/@engine9/id@1/dist/id.iife.js" defer></script>
<script src="/assets/site.js" defer></script>
</body>
</html>`;
}

/** Tags are stored as slugs ("90s-tech"); show them with spaces. */
export const tagLabel = (tag) => String(tag).replace(/-/g, ' ');

function tagLinks(tags, current) {
  if (!tags.length) return '';
  return `<nav class="tags" aria-label="Browse by topic">${tags
    .map((t) => {
      const tag = typeof t === 'string' ? t : t.tag;
      return `<a href="/tag/${encodeURIComponent(tag)}"${tag === current ? ' aria-current="page"' : ''}>${e(tagLabel(tag))}</a>`;
    })
    .join('')}</nav>`;
}

function mosaic({ posts, next, tag, emptyText }) {
  if (!posts.length) {
    return `<p class="empty">${e(emptyText)}</p>`;
  }
  const feed = `/api/site/posts${tag ? `?tag=${encodeURIComponent(tag)}` : ''}`;
  return `<div class="mosaic" data-feed="${e(feed)}" data-next="${next ?? ''}">
${posts.map(postCard).join('\n')}
</div>
${next ? `<p class="more"><a class="button" href="?before=${next}" data-load-more>Show more memes</a></p>` : ''}`;
}

export function homePage(env, { posts, next, tags, before }) {
  const site = siteConfig(env);
  const body = `<h1 class="visually-hidden">${e(site.name)}</h1>
${tagLinks(tags)}
${mosaic({ posts, next, emptyText: 'No memes yet. Drop an image into the Google Drive folder and it will show up here within ten minutes.' })}`;
  return layout(env, {
    path: before ? `/?before=${before}` : '/',
    noindex: !!before,
    page: 'home',
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: site.name,
      url: `${site.url}/`,
      description: site.tagline
    },
    body
  });
}

export function tagPage(env, { tag, posts, next, tags, before }) {
  const body = `<h1 class="page-title">${e(tagLabel(tag))} memes</h1>
${tagLinks(tags, tag)}
${mosaic({ posts, next, tag, emptyText: `Nothing tagged “${tagLabel(tag)}” yet.` })}`;
  return layout(env, {
    title: `${tagLabel(tag)} memes`,
    description: `Xennial memes about ${tagLabel(tag)}.`,
    path: `/tag/${encodeURIComponent(tag)}${before ? `?before=${before}` : ''}`,
    noindex: !!before,
    page: 'tag',
    body
  });
}

function formatDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

export function postPage(env, { post, comments, neighbours: near }) {
  const site = siteConfig(env);
  const url = `${site.url}/p/${post.slug}`;
  const body = `<article class="post" data-post-id="${post.id}">
  <figure class="post-figure">
    <a href="${e(imageUrl(post))}"><img src="${e(imageUrl(post))}" alt="${e(post.alt_text)}"${post.width ? ` width="${post.width}" height="${post.height}"` : ''} fetchpriority="high"></a>
  </figure>
  <div class="post-side">
    <h1 class="post-title">${e(post.title)}</h1>
    ${post.description ? `<p class="post-desc">${e(post.description)}</p>` : ''}
    <p class="post-date"><time datetime="${e(post.created_at)}">${e(formatDate(post.created_at))}</time></p>
    <div class="post-actions">
      <button type="button" class="fav" data-fav aria-pressed="false">
        <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20"><path d="M12 20.5 3.6 12.6a5 5 0 0 1 7.1-7.1L12 6.8l1.3-1.3a5 5 0 0 1 7.1 7.1Z"/></svg>
        <span data-fav-label>Favorite</span>
        <span class="fav-count" data-fav-count>${post.favorite_count || 0}</span>
      </button>
      <button type="button" class="button-quiet" data-share>Copy link</button>
      <button type="button" class="button-quiet admin-only" data-hide-post hidden>Hide from site</button>
    </div>
    ${tagLinks(post.tags)}
    <details class="alt-text">
      <summary>Image description</summary>
      <p>${e(post.alt_text)}</p>
    </details>
    <section class="comments" aria-labelledby="comments-h">
      <h2 id="comments-h">Comments <span class="count">${comments.length || ''}</span></h2>
      <ol class="comment-list" data-comments>
        ${comments.map((c) => commentItem(c)).join('')}
      </ol>
      ${comments.length ? '' : '<p class="empty-small" data-no-comments>No comments yet. Start the thread.</p>'}
      <div class="comment-gate" data-comment-gate>
        <p>Log in to comment and save favorites.</p>
      </div>
      <form class="comment-form" data-comment-form hidden>
        <label for="comment-body">Add a comment as <strong data-handle></strong></label>
        <textarea id="comment-body" name="body" rows="3" maxlength="1000" required></textarea>
        <div class="form-row"><button type="submit" class="button">Post comment</button><span class="form-msg" role="status" data-comment-msg></span></div>
      </form>
    </section>
    <nav class="post-nav" aria-label="More memes">
      ${near.newer ? `<a rel="prev" href="/p/${e(near.newer.slug)}">Newer: ${e(near.newer.title)}</a>` : '<span></span>'}
      ${near.older ? `<a rel="next" href="/p/${e(near.older.slug)}">Older: ${e(near.older.title)}</a>` : ''}
    </nav>
  </div>
</article>
<dialog class="handle-dialog" data-handle-dialog>
  <form method="dialog" data-handle-form>
    <h2>Pick a handle</h2>
    <p>This is the name shown next to your comments. Your email stays private.</p>
    <label for="handle-input">Handle</label>
    <input id="handle-input" name="handle" minlength="3" maxlength="24" pattern="[A-Za-z0-9_]{3,24}" required autocomplete="nickname">
    <p class="form-msg" role="status" data-handle-msg></p>
    <div class="form-row"><button type="submit" class="button" value="save">Save handle</button><button type="button" class="button-quiet" data-handle-cancel>Cancel</button></div>
  </form>
</dialog>`;
  return layout(env, {
    title: post.title,
    description: post.description || post.alt_text.slice(0, 160),
    path: `/p/${post.slug}`,
    image: imageUrl(post),
    imageAlt: post.alt_text,
    page: 'post',
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'ImageObject',
      name: post.title,
      description: post.description,
      caption: post.alt_text,
      contentUrl: `${site.url}${imageUrl(post)}`,
      thumbnailUrl: `${site.url}${thumbUrl(post)}`,
      url,
      datePublished: post.created_at,
      keywords: post.tags.join(', '),
      ...(post.width ? { width: post.width, height: post.height } : {}),
      encodingFormat: post.mime_type
    },
    body
  });
}

export function commentItem(c) {
  return `<li class="comment" data-comment-id="${c.id}">
  <p class="comment-meta"><strong>${e(c.handle)}</strong> <time datetime="${e(c.created_at)}">${e(formatDate(c.created_at))}</time></p>
  <p class="comment-body">${e(c.body).replace(/\n/g, '<br>')}</p>
  <button type="button" class="link-button" data-delete-comment hidden>Delete</button>
</li>`;
}

export function favoritesPage(env) {
  const body = `<h1 class="page-title">Your favorites</h1>
<div data-favorites>
  <p class="empty" data-favorites-msg>Log in to see the memes you've saved.</p>
  <div class="mosaic" data-favorites-grid hidden></div>
</div>`;
  return layout(env, { title: 'Your favorites', path: '/favorites', noindex: true, page: 'favorites', body });
}

export function notFoundPage(env) {
  const body = `<div class="notfound">
  <h1 class="page-title">This page has gone the way of Blockbuster</h1>
  <p>The link may be old, or the meme was taken down.</p>
  <p><a class="button" href="/">Back to the memes</a></p>
</div>`;
  return layout(env, { title: 'Page not found', path: '/404', noindex: true, page: 'notfound', body });
}

/* ---- feeds --------------------------------------------------------------- */

const xml = (s) => e(s);

export function sitemapXml(env, rows, tags) {
  const site = siteConfig(env);
  const urls = [
    `<url><loc>${site.url}/</loc><changefreq>hourly</changefreq></url>`,
    ...tags.map((t) => `<url><loc>${site.url}/tag/${xml(encodeURIComponent(t.tag))}</loc></url>`),
    ...rows.map(
      (r) =>
        `<url><loc>${site.url}/p/${xml(r.slug)}</loc><lastmod>${xml(String(r.created_at).slice(0, 10))}</lastmod><image:image><image:loc>${site.url}/i/${xml(r.image_key)}</image:loc></image:image></url>`
    )
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls.join('\n')}
</urlset>`;
}

export function robotsTxt(env) {
  const site = siteConfig(env);
  return `User-agent: *
Disallow: /api/
Disallow: /favorites
Sitemap: ${site.url}/sitemap.xml
`;
}

export function rssXml(env, posts) {
  const site = siteConfig(env);
  const items = posts
    .map(
      (p) => `<item>
  <title>${xml(p.title)}</title>
  <link>${site.url}/p/${xml(p.slug)}</link>
  <guid isPermaLink="true">${site.url}/p/${xml(p.slug)}</guid>
  <pubDate>${new Date(p.created_at).toUTCString()}</pubDate>
  <description>${xml(`<p><img src="${site.url}${imageUrl(p)}" alt="${e(p.alt_text)}"></p><p>${e(p.description)}</p>`)}</description>
  <enclosure url="${site.url}${xml(imageUrl(p))}" type="${xml(p.mime_type)}" length="0"/>
</item>`
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
<title>${xml(site.name)}</title>
<link>${site.url}/</link>
<description>${xml(site.tagline)}</description>
${items}
</channel>
</rss>`;
}
