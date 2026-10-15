/**
 * Turn new images in the Google Drive folder into posts.
 *
 * Runs on the Worker's cron trigger (every 10 minutes, see wrangler.jsonc)
 * and from POST /api/site/admin/ingest. Each run:
 *   1. lists the images in DRIVE_FOLDER_ID,
 *   2. hides posts whose Drive file is gone (and restores ones that return),
 *   3. for up to INGEST_BATCH new files: downloads, asks Claude for alt text,
 *      title, description, tags and an SEO file name, stores the image in R2
 *      as <seo-file-name>.<ext> (plus a WebP thumbnail when the Images
 *      binding is on), and inserts the post.
 */
import { createDriveClient, getAccessToken, parseServiceAccount } from './drive.js';
import { captionImage, DEFAULT_MODEL } from './caption.js';
import { EXTENSION_FOR_MIME, imageSize } from '../lib/util.js';
import {
  ingestErrors,
  insertPost,
  knownDriveIds,
  recordIngestError,
  slugExists,
  syncDriveRemovals
} from '../lib/db.js';
import { addTags, aliasMap, createMatcher, resolveTags, vocabulary } from '../lib/tags.js';

const MAX_ATTEMPTS = 3;
const MAX_SOURCE_BYTES = 20 * 1024 * 1024; // Images binding input limit
const MAX_CAPTION_BYTES = 7 * 1024 * 1024; // keeps the base64 request under Claude's 10 MB image limit
const CAPTION_LONG_EDGE = 1568;
const THUMB_WIDTH = 640;

/** Pick a slug that is not used yet: "x", then "x-2", "x-3", ... */
export async function uniqueSlug(db, base) {
  let candidate = base;
  for (let n = 2; await slugExists(db, candidate); n++) candidate = `${base}-${n}`;
  return candidate;
}

/** A Drive name is worth passing to Claude only if a person wrote it. */
export function usefulHint(file) {
  const stem = String(file.name || '').replace(/\.[a-z0-9]+$/i, '');
  const parts = [];
  if (stem && !/^(img|image|dsc|pxl|screenshot|screen shot|photo|untitled|download)[\s_-]*[\d\s_.-]*/i.test(stem) && !/^[\d\s_.-]+$/.test(stem)) {
    parts.push(stem.replace(/[_-]+/g, ' '));
  }
  if (file.description) parts.push(file.description);
  return parts.join(' — ').slice(0, 300);
}

async function resize(images, bytes, width, format) {
  const stream = new Blob([bytes]).stream();
  const result = await images.input(stream).transform({ width }).output({ format, quality: 82 });
  const res = result.response();
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * @returns {Promise<{ listed: number, created: Array<{slug: string, title: string}>, failed: Array<{name: string, error: string}>, removed: number, pending: number }>}
 */
export async function runIngest(env, { limit, drive: driveOverride, caption = captionImage, log = console } = {}) {
  const db = env.DB;
  if (!env.DRIVE_FOLDER_ID) throw new Error('DRIVE_FOLDER_ID is not set');
  if (!env.MEDIA) throw new Error('The MEDIA R2 bucket binding is missing');

  const drive =
    driveOverride ||
    createDriveClient({ accessToken: await getAccessToken(parseServiceAccount(env.GOOGLE_SERVICE_ACCOUNT_JSON)) });

  const files = await drive.listImages(env.DRIVE_FOLDER_ID);
  // Only trust an empty listing if the folder really is empty: a sharing
  // mistake should not take the whole site down.
  const removed = files.length ? await syncDriveRemovals(db, files.map((f) => f.id)) : 0;

  const known = await knownDriveIds(db);
  const errors = await ingestErrors(db);
  const fresh = files.filter(
    (f) => !known.has(f.id) && (errors.get(f.id) || 0) < MAX_ATTEMPTS && EXTENSION_FOR_MIME[f.mimeType]
  );
  const batch = fresh.slice(0, Number(limit ?? env.INGEST_BATCH ?? 5));

  // The tag vocabulary is shared with Claude and grows as this run adds tags.
  const tagging = batch.length ? { vocab: await vocabulary(db), aliases: await aliasMap(db) } : null;

  const created = [];
  const failed = [];
  for (const file of batch) {
    try {
      const post = await ingestOne(env, drive, file, caption, tagging);
      if (post) created.push(post);
    } catch (err) {
      const message = err?.message || String(err);
      log.error?.(`ingest failed for ${file.name} (${file.id}): ${message}`);
      await recordIngestError(db, { driveFileId: file.id, driveName: file.name, error: message });
      failed.push({ name: file.name, error: message });
    }
  }
  return { listed: files.length, created, failed, removed, pending: fresh.length - batch.length };
}

async function ingestOne(env, drive, file, caption, tagging) {
  if (Number(file.size) > MAX_SOURCE_BYTES) throw new Error(`file is larger than ${MAX_SOURCE_BYTES / 1048576} MB`);
  const bytes = await drive.download(file.id);
  const size = imageSize(bytes) || {};
  const mimeType = size.mime || file.mimeType;
  const ext = EXTENSION_FOR_MIME[mimeType];
  if (!ext) throw new Error(`unsupported image type ${mimeType}`);
  const width = size.width || file.imageMediaMetadata?.width || null;
  const height = size.height || file.imageMediaMetadata?.height || null;

  // What Claude sees: the original when it is small enough, otherwise a downscaled JPEG.
  let captionBytes = bytes;
  let captionMime = mimeType;
  const longEdge = Math.max(width || 0, height || 0);
  if (env.IMAGES && (bytes.length > MAX_CAPTION_BYTES || longEdge > 2 * CAPTION_LONG_EDGE)) {
    const targetWidth = width && height && height > width ? Math.round((CAPTION_LONG_EDGE * width) / height) : CAPTION_LONG_EDGE;
    captionBytes = await resize(env.IMAGES, bytes, targetWidth, 'image/jpeg');
    captionMime = 'image/jpeg';
  }
  if (captionBytes.length > MAX_CAPTION_BYTES) {
    throw new Error('image is too large to caption; turn on the Images binding or upload a smaller file');
  }

  const meta = await caption({
    bytes: captionBytes,
    mimeType: captionMime,
    hint: usefulHint(file),
    vocab: tagging.vocab,
    apiKey: env.ANTHROPIC_API_KEY,
    model: env.CLAUDE_MODEL || DEFAULT_MODEL
  });

  // Map Claude's tags onto the vocabulary: exact slugs, retired aliases and
  // spelling variants all land on the existing tag; only genuinely new ones are added.
  const { tags, created: newTags } = resolveTags(meta.tags, createMatcher(tagging.vocab, tagging.aliases));
  await addTags(env.DB, newTags);
  tagging.vocab.push(...newTags.map((t) => ({ ...t, n: 0 })));

  const slug = await uniqueSlug(env.DB, meta.filename);
  const imageKey = `${slug}.${ext}`;
  const cacheControl = 'public, max-age=31536000, immutable';
  await env.MEDIA.put(imageKey, bytes, { httpMetadata: { contentType: mimeType, cacheControl } });

  let thumbKey = null;
  if (env.IMAGES && width && width > THUMB_WIDTH && mimeType !== 'image/gif') {
    try {
      const thumb = await resize(env.IMAGES, bytes, THUMB_WIDTH, 'image/webp');
      thumbKey = `thumbs/${slug}.webp`;
      await env.MEDIA.put(thumbKey, thumb, { httpMetadata: { contentType: 'image/webp', cacheControl } });
    } catch {
      thumbKey = null; // the grid falls back to the original
    }
  }

  const id = await insertPost(env.DB, {
    slug,
    title: meta.title,
    alt_text: meta.alt_text,
    description: meta.description,
    tags,
    image_key: imageKey,
    thumb_key: thumbKey,
    mime_type: mimeType,
    width,
    height,
    bytes: bytes.length,
    drive_file_id: file.id,
    drive_name: file.name
  });
  if (!id) {
    // Another run got there first; drop the copies this run stored.
    await env.MEDIA.delete(thumbKey ? [imageKey, thumbKey] : [imageKey]);
    return null;
  }
  return { slug, title: meta.title, tags };
}
