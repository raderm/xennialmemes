#!/usr/bin/env node
/*
  Copy engine9's browser login library into the site, so pages load it from
  xennialmemes.com instead of a CDN (unpkg returns 404 for it).

    node scripts/vendor-id.js

  Writes public/assets/vendor/engine9-id.js from the installed @engine9/id
  package. Runs automatically after `npm install`, before `npm run dev`, and in
  wrangler's build step on every deploy, so the copy always matches the
  installed version. The file is generated: it is gitignored, don't edit it.

  Uses the package's ready-made browser bundle (dist/id.iife.js) when it is
  there; otherwise bundles the package with esbuild, which wrangler already
  installs.

  If the library can't be found this prints a warning and exits 0, so a
  missing login library never blocks `npm install` or a deploy; the site
  works without it, just with no Log in button.
*/
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const root = process.cwd();
const pkgDir = path.join(root, 'node_modules', '@engine9', 'id');
const outDir = path.join(root, 'public', 'assets', 'vendor');
const out = path.join(outDir, 'engine9-id.js');

function skip(reason) {
  console.warn(`WARNING: engine9 login library not copied: ${reason}`);
  console.warn('The site still works; the Log in button stays hidden until this is fixed.');
  process.exit(0);
}

if (!existsSync(pkgDir)) skip('@engine9/id is not installed (run `npm install` and check it succeeds).');
mkdirSync(outDir, { recursive: true });

const ready = path.join(pkgDir, 'dist', 'id.iife.js');
if (existsSync(ready)) {
  copyFileSync(ready, out);
  console.log('engine9 login library: copied dist/id.iife.js to public/assets/vendor/engine9-id.js');
  process.exit(0);
}

// No browser bundle in the package: build one that sets window.engine9Id.

let esbuild;
for (const from of [root, path.join(root, 'node_modules', 'wrangler')]) {
  try {
    esbuild = createRequire(path.join(from, 'package.json'))('esbuild');
    break;
  } catch {
    // try the next place
  }
}
if (!esbuild) skip('esbuild was not found (it is normally installed with wrangler; run `npm install`).');

let result;
try {
  result = await esbuild.build({
  stdin: {
    contents: "import * as engine9Id from '@engine9/id'; window.engine9Id = engine9Id;",
    resolveDir: root,
    loader: 'js'
  },
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  write: false,
  logLevel: 'silent'
  });
} catch (err) {
  skip(`bundling @engine9/id failed: ${err.message.split('\n')[0]}`);
}
writeFileSync(out, result.outputFiles[0].contents);
console.log('engine9 login library: bundled @engine9/id into public/assets/vendor/engine9-id.js');
