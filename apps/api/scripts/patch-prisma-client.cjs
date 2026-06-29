/**
 * Workaround for Prisma 6.7+ generated client on non-ASCII (e.g. CJK) project paths.
 *
 * The generated `.prisma/client/default.js` uses a Node "subpath imports" specifier
 * `require('#main-entry-point')`. Node's subpath-imports resolver is URL-based and
 * fails to locate the package.json `imports` map when the absolute path contains
 * non-ASCII characters on Windows (this repo lives under a CJK path). Regular
 * relative requires are unaffected, so we rewrite the indirection to `./index.js`.
 *
 * Runs automatically after `prisma generate` (see package.json scripts). Idempotent.
 */
const fs = require('node:fs');
const path = require('node:path');

function findDefaultJs() {
  // Locate the generated client relative to @prisma/client's real install location,
  // so this works regardless of pnpm hoisting.
  const clientPkg = require.resolve('@prisma/client/package.json');
  // node_modules/@prisma/client/package.json -> node_modules/.prisma/client/default.js
  const target = path.join(path.dirname(clientPkg), '..', '..', '.prisma', 'client', 'default.js');
  return fs.existsSync(target) ? target : null;
}

function main() {
  const file = findDefaultJs();
  if (!file) {
    console.warn('[patch-prisma-client] .prisma/client/default.js not found — skipping.');
    return;
  }
  const original = fs.readFileSync(file, 'utf8');
  if (!original.includes('#main-entry-point')) {
    console.log('[patch-prisma-client] already patched — nothing to do.');
    return;
  }
  const patched = original.replace(/require\('#main-entry-point'\)/g, "require('./index.js')");
  fs.writeFileSync(file, patched);
  console.log('[patch-prisma-client] patched', path.relative(process.cwd(), file));
}

main();
