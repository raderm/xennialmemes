#!/usr/bin/env node
/*
  Apply the site's own tables (migrations-site/*.sql) to the database.

    node scripts/migrate.js --local     # the local copy used by `npm run dev`
    node scripts/migrate.js --remote    # production D1

  Why not `wrangler d1 migrations apply`: `npx e9core setup` keeps engine9's
  tables in migrations/0001_engine9.sql and loads them with
  `wrangler d1 execute --file`, so that folder must not be applied as
  migrations (it fails with "table api_key already exists"). The site's
  files are written to be safe to run again (CREATE ... IF NOT EXISTS,
  INSERT OR IGNORE), so each run simply executes all of them in order.
*/
import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const where = process.argv.includes('--remote') ? '--remote' : '--local';
const dir = 'migrations-site';

// The D1 database name from wrangler.jsonc (e9core setup uses "engine9").
const config = readFileSync('wrangler.jsonc', 'utf8');
const database = config.match(/"database_name"\s*:\s*"([^"]+)"/)?.[1] || 'engine9';

const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
for (const file of files) {
  console.log(`Applying ${dir}/${file} to ${database} (${where.slice(2)})`);
  const run = spawnSync('npx', ['wrangler', 'd1', 'execute', database, where, '--file', `${dir}/${file}`], {
    stdio: 'inherit'
  });
  if (run.status !== 0) {
    console.error(`\n${file} failed. Nothing after it was applied; fix the error above and run this again.`);
    process.exit(run.status || 1);
  }
}
console.log(`Site tables are up to date (${files.length} files).`);
