/**
 * Verify every named import in every module actually exists.
 *
 * Two check scripts shipped with `waitForPort` imported from the wrong module;
 * the failure only appears at run time, after a minute of booting a server. This
 * makes the whole class of mistake a one-second static check.
 *
 *   node scripts/imports-check.mjs
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const log = (m) => console.log(`[imports] ${m}`);

const files = [
  ...readdirSync(join(root, 'lib'))
    .filter((f) => /\.(mjs|js)$/.test(f))
    .map((f) => join('lib', f)),
  ...readdirSync(join(root, 'scripts'))
    .filter((f) => f.endsWith('.mjs'))
    .map((f) => join('scripts', f)),
];

const NAMED_FROM = /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g;

let failures = 0;
const exportCache = new Map();

async function exportsOf(specifier, fromFile) {
  if (!specifier.startsWith('.')) return null; // bare specifiers are packages
  const target = new URL(specifier, pathToFileURL(resolve(root, fromFile))).href;
  if (exportCache.has(target)) return exportCache.get(target);
  const mod = await import(target);
  const names = new Set(Object.keys(mod));
  // `export default { ... }` and re-exports are not enumerated here; only the
  // names the module literally exports matter for a static import check.
  exportCache.set(target, names);
  return names;
}

for (const file of files) {
  const source = readFileSync(join(root, file), 'utf8');
  for (const match of source.matchAll(NAMED_FROM)) {
    const names = match[1]
      .split(',')
      .map((part) => part.trim().split(/\s+as\s+/)[0].trim())
      .filter((name) => name !== '');
    const specifier = match[2];
    let available;
    try {
      available = await exportsOf(specifier, file);
    } catch (error) {
      failures += 1;
      log(`FAIL ${file}: cannot load ${specifier} — ${String(error?.message ?? error).split('\n')[0]}`);
      continue;
    }
    if (available === null) continue;
    for (const name of names) {
      if (!available.has(name)) {
        failures += 1;
        log(`FAIL ${file}: "${name}" is not exported by ${specifier}`);
      }
    }
  }
}

log(failures === 0 ? `all named imports resolve (${files.length} modules)` : `${failures} bad import(s)`);
process.exit(failures === 0 ? 0 : 1);
