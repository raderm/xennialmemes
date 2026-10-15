#!/usr/bin/env node
/*
  Check Google Drive for new memes now, instead of waiting for the 10-minute cron.

    node scripts/ingest.js http://localhost:8787        # local wrangler dev
    node scripts/ingest.js https://xennialmemes.com     # production
    node scripts/ingest.js https://xennialmemes.com 20  # up to 20 files this run

  Uses E9_ADMIN_API_KEY from .env (written by `npx e9core setup`).
*/
import { readFileSync, existsSync } from 'node:fs';

const [base = 'http://localhost:8787', limit = ''] = process.argv.slice(2);

let key = process.env.E9_ADMIN_API_KEY;
if (!key && existsSync('.env')) {
  const line = readFileSync('.env', 'utf8')
    .split('\n')
    .find((l) => l.startsWith('E9_ADMIN_API_KEY='));
  key = line?.slice('E9_ADMIN_API_KEY='.length).trim().replace(/^["']|["']$/g, '');
}
if (!key) {
  console.error('E9_ADMIN_API_KEY not found. Run `npx e9core setup` first, or export it.');
  process.exit(1);
}

const url = new URL('/api/site/admin/ingest', base);
if (limit) url.searchParams.set('limit', limit);
const res = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${key}` } });
const body = await res.json().catch(() => ({}));
console.log(JSON.stringify(body, null, 2));
if (!res.ok) process.exit(1);
