/** Test doubles: a D1-shaped wrapper over node:sqlite and an in-memory R2 bucket. */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

class Statement {
  constructor(db, sql, args = []) {
    this.db = db;
    this.sql = sql;
    this.args = args;
  }
  bind(...args) {
    return new Statement(this.db, this.sql, args);
  }
  async all() {
    return { results: this.db.prepare(this.sql).all(...this.args) };
  }
  async first() {
    return this.db.prepare(this.sql).get(...this.args) ?? null;
  }
  async run() {
    const info = this.db.prepare(this.sql).run(...this.args);
    return { meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
  }
}

export function createD1() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const file of ['0001_site.sql', '0002_tags.sql']) {
    db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  }
  return {
    raw: db,
    prepare: (sql) => new Statement(db, sql),
    async batch(statements) {
      db.exec('BEGIN');
      try {
        const out = [];
        for (const s of statements) out.push(await s.run());
        db.exec('COMMIT');
        return out;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    }
  };
}

export function createR2() {
  const objects = new Map();
  return {
    objects,
    async put(key, value, opts = {}) {
      objects.set(key, { bytes: new Uint8Array(value), httpMetadata: opts.httpMetadata || {} });
    },
    async get(key) {
      const o = objects.get(key);
      if (!o) return null;
      return {
        body: new Blob([o.bytes]).stream(),
        httpEtag: '"etag"',
        writeHttpMetadata(headers) {
          if (o.httpMetadata.contentType) headers.set('content-type', o.httpMetadata.contentType);
          if (o.httpMetadata.cacheControl) headers.set('cache-control', o.httpMetadata.cacheControl);
        }
      };
    },
    async delete(keys) {
      for (const k of [].concat(keys)) objects.delete(k);
    }
  };
}

/** A 1x1-ish PNG header with the given size, enough for imageSize(). */
export function fakePng(width, height) {
  const b = new Uint8Array(64);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const v = new DataView(b.buffer);
  v.setUint32(16, width);
  v.setUint32(20, height);
  return b;
}

/** Sessions in tests are just "person:<id>" or "admin:<id>". */
export function fakeVerify(token) {
  const m = /^(person|admin):(\d+)$/.exec(token || '');
  if (!m) return null;
  return { personId: Number(m[2]), email: m[1] === 'admin' ? 'boss@example.com' : `p${m[2]}@example.com` };
}

export function request(path, { method = 'GET', session, body, headers = {} } = {}) {
  const h = new Headers(headers);
  if (session) h.set('x-engine9-session', session);
  if (body !== undefined) h.set('content-type', 'application/json');
  return new Request(`https://xennialmemes.com${path}`, {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}
