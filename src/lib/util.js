/** Small helpers shared by pages, the site API, and the Drive ingest. */

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }
  });
}

const STOP_WORDS = new Set(['a', 'an', 'the', 'of', 'and', 'or', 'to', 'in', 'on', 'for', 'with', 'is', 'it', 'this', 'that']);

/**
 * SEO file-name stem: lowercase ASCII words joined by hyphens, filler words
 * dropped, at most `maxWords` words and 60 characters.
 */
export function slugify(text, { maxWords = 8, maxLength = 60 } = {}) {
  const words = String(text ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const meaningful = words.filter((w) => !STOP_WORDS.has(w));
  const chosen = (meaningful.length >= 2 ? meaningful : words).slice(0, maxWords);
  let slug = '';
  for (const word of chosen) {
    const next = slug ? `${slug}-${word}` : word;
    if (next.length > maxLength) break;
    slug = next;
  }
  return slug;
}

export function normalizeTag(tag) {
  return slugify(tag, { maxWords: 4, maxLength: 30 });
}

export const EXTENSION_FOR_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp'
};

/**
 * Read width and height from the first bytes of a JPEG, PNG, GIF or WebP.
 * Returns null when the format is not recognised.
 */
export function imageSize(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const u16be = (i) => (b[i] << 8) | b[i + 1];
  const u16le = (i) => b[i] | (b[i + 1] << 8);
  const u32be = (i) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];

  // PNG
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { width: u32be(16), height: u32be(20), mime: 'image/png' };
  }
  // GIF
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
    return { width: u16le(6), height: u16le(8), mime: 'image/gif' };
  }
  // WebP
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) {
    const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (chunk === 'VP8 ') return { width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff, mime: 'image/webp' };
    if (chunk === 'VP8L') {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, mime: 'image/webp' };
    }
    if (chunk === 'VP8X') {
      return {
        width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)),
        height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)),
        mime: 'image/webp'
      };
    }
    return null;
  }
  // JPEG: walk the segments to the first start-of-frame marker.
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const length = u16be(i + 2);
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) return { width: u16be(i + 7), height: u16be(i + 5), mime: 'image/jpeg' };
      i += 2 + length;
    }
    return null;
  }
  return null;
}

export function bytesToBase64(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < b.length; i += chunk) {
    binary += String.fromCharCode.apply(null, b.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64UrlEncode(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function parseTags(value) {
  try {
    const tags = JSON.parse(value || '[]');
    return Array.isArray(tags) ? tags : [];
  } catch {
    return [];
  }
}

/** Constant-time string comparison for secrets. */
export function safeEqual(a, b) {
  const x = new TextEncoder().encode(String(a ?? ''));
  const y = new TextEncoder().encode(String(b ?? ''));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
