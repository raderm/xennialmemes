/**
 * Google Drive access with a service account, using only Web Crypto and
 * fetch so it runs inside a Cloudflare Worker.
 *
 * Setup: create a service account in Google Cloud, enable the Drive API, make
 * a JSON key, and share the Drive folder with the service account's email
 * (Viewer is enough). The key goes in the GOOGLE_SERVICE_ACCOUNT_JSON secret.
 */
import { base64UrlEncode } from '../lib/util.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_URL = 'https://www.googleapis.com/drive/v3';
const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

export function parseServiceAccount(raw) {
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not set');
  let text = String(raw).trim();
  // Accept the key base64-encoded too, which is easier to keep on one line in .env.
  if (!text.startsWith('{')) text = atob(text);
  const account = JSON.parse(text);
  if (!account.client_email || !account.private_key) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON needs client_email and private_key');
  }
  return account;
}

function pemToDer(pem) {
  const body = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '');
  const binary = atob(body);
  const der = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) der[i] = binary.charCodeAt(i);
  return der.buffer;
}

/** Signed JWT assertion for the OAuth token exchange. */
export async function createAssertion(account, { now = Math.floor(Date.now() / 1000) } = {}) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = { iss: account.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 };
  const unsigned = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(claims))}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(account.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${base64UrlEncode(signature)}`;
}

export async function getAccessToken(account, { fetchImpl = fetch } = {}) {
  const assertion = await createAssertion(account);
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(`Google token exchange failed (${res.status}): ${body.error_description || body.error || 'no token'}`);
  }
  return body.access_token;
}

export function createDriveClient({ accessToken, fetchImpl = fetch }) {
  const auth = { authorization: `Bearer ${accessToken}` };

  /** Every image directly inside `folderId`, oldest first. */
  async function listImages(folderId) {
    const files = [];
    let pageToken;
    do {
      const url = new URL(`${DRIVE_URL}/files`);
      url.searchParams.set('q', `'${folderId.replace(/'/g, "\\'")}' in parents and mimeType contains 'image/' and trashed = false`);
      url.searchParams.set(
        'fields',
        'nextPageToken, files(id, name, mimeType, size, createdTime, description, imageMediaMetadata(width, height))'
      );
      url.searchParams.set('orderBy', 'createdTime');
      url.searchParams.set('pageSize', '200');
      url.searchParams.set('supportsAllDrives', 'true');
      url.searchParams.set('includeItemsFromAllDrives', 'true');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const res = await fetchImpl(url, { headers: auth });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(`Drive list failed (${res.status}): ${body.error?.message || 'unknown error'}`);
      }
      files.push(...(body.files || []));
      pageToken = body.nextPageToken;
    } while (pageToken);
    return files;
  }

  async function download(fileId) {
    const url = `${DRIVE_URL}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;
    const res = await fetchImpl(url, { headers: auth });
    if (!res.ok) throw new Error(`Drive download failed (${res.status}) for ${fileId}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  return { listImages, download };
}
