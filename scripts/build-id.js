#!/usr/bin/env node
/*
  Build engine9's browser login library (@engine9/id, MIT) into the site.

  @engine9/id is not published on npm, so it can't be installed or loaded
  from a CDN. This turns its TypeScript source into plain ES modules that
  browsers load directly, using only Node's built-in type stripping (no
  bundler, no npm install):

    git clone https://github.com/engine9-ai/id.git ~/engine9-id
    node scripts/build-id.js ~/engine9-id

  Output: public/assets/vendor/engine9-id/*.js (committed to this repo).
  Pages load iife.js, which sets window.engine9Id. Re-run after pulling a
  newer engine9-id to update.
*/
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const repo = process.argv[2];
if (!repo || !existsSync(path.join(repo, 'src', 'iife.ts'))) {
  console.error('Usage: node scripts/build-id.js <path to a clone of github.com/engine9-ai/id>');
  process.exit(1);
}
const src = path.join(repo, 'src');
const out = path.resolve('public', 'assets', 'vendor', 'engine9-id');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const pkg = JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8'));
let commit = '';
try {
  commit = execFileSync('git', ['-C', repo, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
} catch {
  commit = 'unknown';
}
const banner = `/* @engine9/id ${pkg.version} (${commit}), MIT license, see LICENSE. Built by scripts/build-id.js; do not edit. */\n`;

const files = readdirSync(src).filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'));
for (const file of files) {
  const ts = readFileSync(path.join(src, file), 'utf8');
  // 'transform' also rewrites the few non-erasable bits (constructor parameter properties).
  let js = stripTypeScriptTypes(ts, { mode: 'transform', sourceUrl: file });
  // Browsers need file extensions on relative imports: './client' -> './client.js'.
  js = js.replace(/(\bfrom\s*|\bimport\s*\(?\s*)(['"])(\.\.?\/[^'"]+?)(?<!\.js)\2/g, '$1$2$3.js$2');
  if (/\bfrom\s*['"](?!\.)/.test(js)) {
    console.error(`${file} imports a package; this build only handles relative imports.`);
    process.exit(1);
  }
  writeFileSync(path.join(out, file.replace(/\.ts$/, '.js')), banner + js);
}
copyFileSync(path.join(repo, 'LICENSE'), path.join(out, 'LICENSE'));
console.log(`Built @engine9/id ${pkg.version} (${commit}): ${files.length} modules in public/assets/vendor/engine9-id/`);
