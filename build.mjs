// ============================================================
// WIOS deploy-time build.
// Compiles the inline text/babel script ONCE here on Netlify, so phones no
// longer run the Babel compiler on every app open (big startup win).
//
// - Source of truth stays index.html at the repo root: John keeps editing and
//   pushing exactly as before. Opening the source file directly still works
//   in a browser because it keeps the Babel CDN tag; only the deployed copy
//   in dist/ is precompiled.
// - The compiled dist/index.html keeps the APP_BUILD marker verbatim, so the
//   in-app stale-build auto-reload keeps working unchanged.
// - If anything in here throws, the Netlify build fails and the previous
//   deploy stays live. It can never publish a broken half-build.
// ============================================================
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, existsSync } from 'fs';
import Babel from '@babel/standalone';

const OUT = 'dist';

const src = readFileSync('index.html', 'utf8');

// 1) Pull out the single inline text/babel script.
const open = '<script type="text/babel">';
const start = src.indexOf(open);
if (start < 0) throw new Error('text/babel script tag not found');
const bodyStart = start + open.length;
const end = src.indexOf('</script>', bodyStart);
if (end < 0) throw new Error('closing script tag not found');
const code = src.slice(bodyStart, end);

// 2) Compile with the same Babel 7 the browser was using.
let compiled = Babel.transform(code, {
  presets: ['react'],
  sourceType: 'script',
}).code;
if (!compiled || compiled.length < code.length * 0.5) {
  throw new Error('compiled output suspiciously small, aborting');
}

// 2b) Normalize the marker back to the exact source spelling APP_BUILD='wb-...'.
// Babel rewrites it as "APP_BUILD = 'wb-...'" (spaces), but phones still running
// build wb-20260718-2 look for the strict no-space form; without this line those
// phones would never detect the new build and never auto-update.
const mm = compiled.match(/APP_BUILD\s*=\s*['"](wb-[^'"]+)['"]/);
if (!mm) throw new Error('APP_BUILD marker missing from compiled output');
compiled = compiled.replace(mm[0], `APP_BUILD='${mm[1]}'`);

// 3) Sanity checks before we dare publish: BOTH the old strict regex (deployed
// phones) and the new tolerant regex must find the marker in the output.
if (!/APP_BUILD='wb-[^']+'/.test(compiled)) {
  throw new Error('strict marker form missing: old builds could not auto-update');
}
if (!/APP_BUILD\s*=\s*['"]wb-[^'"]+['"]/.test(compiled)) {
  throw new Error('APP_BUILD marker missing from compiled output');
}

// 4) Reassemble: plain <script>, drop the Babel CDN tag (no longer needed).
let out =
  src.slice(0, start) +
  '<script>\n' + compiled + '\n' +
  src.slice(end);
out = out.replace(
  /<script src="https:\/\/unpkg\.com\/@babel\/standalone[^"]*"><\/script>\s*/,
  ''
);
if (out.includes('text/babel')) throw new Error('text/babel still present after build');

// 5) Write dist/ with everything the site serves.
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/index.html`, out);
for (const p of ['sw.js', 'manifest.webmanifest', 'icons', 'guide-img']) {
  if (existsSync(p)) cpSync(p, `${OUT}/${p}`, { recursive: true });
}

console.log(`build ok: index.html ${src.length} -> ${out.length} chars (precompiled)`);
