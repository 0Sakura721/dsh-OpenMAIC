/**
 * Prove what the switch actually changes.
 *
 *   node scripts/allowlocal-behaviour.mjs
 *
 * `ALLOW_LOCAL_NETWORKS` is not a blanket "allow everything": it decides one
 * branch of OpenMAIC's address policy. Rather than assert that from reading code,
 * this compiles OpenMAIC's real `ssrf-guard.ts` and exercises
 * `connectionAddressBlockReason` under both policies, so the switch's promise is
 * checked against the implementation that enforces it.
 *
 * Expectations:
 *  - loopback / RFC1918 / link-local / CGNAT: blocked when off, allowed when on;
 *  - cloud metadata (169.254.169.254 …): blocked in BOTH states;
 *  - public unicast: allowed in both states.
 */

import { createRequire } from 'node:module';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const guardSource = resolve(root, 'vendor', 'OpenMAIC', 'lib', 'server', 'ssrf-guard.ts');

// esbuild ships inside the OpenMAIC checkout, not in this plugin.
const requireFromCheckout = createRequire(join(root, 'vendor', 'OpenMAIC', 'package.json'));
const { build } = requireFromCheckout('esbuild');

const log = (m) => console.log(`[allowlocal] ${m}`);
let failures = 0;
function check(label, ok, detail) {
  if (ok) log(`PASS ${label}`);
  else {
    failures += 1;
    log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

if (!existsSync(guardSource)) {
  console.error(`[allowlocal] guard source not found: ${guardSource}`);
  process.exit(2);
}

// The bundle keeps bare specifiers external, so it must be written somewhere the
// checkout's node_modules can resolve them from.
const workDir = join(root, 'vendor', 'OpenMAIC', '.guard-check');
mkdirSync(workDir, { recursive: true });
const bundlePath = join(workDir, 'guard.mjs');

try {
  // OpenMAIC imports `@/...` and its own packages; bundle with those externals so
  // only the guard module itself is inlined.
  await build({
    entryPoints: [guardSource],
    outfile: bundlePath,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    logLevel: 'silent',
    external: ['@openmaic/*', '@/lib/*', 'undici', 'ipaddr.js', 'zod'],
  });

  const guard = await import(pathToFileURL(bundlePath).href);
  if (typeof guard.connectionAddressBlockReason !== 'function') {
    throw new Error('connectionAddressBlockReason is not exported by the compiled guard');
  }
  const verdict = (address, allow) => guard.connectionAddressBlockReason(address, allow);

  const optInGoverned = [
    ['127.0.0.1', 'loopback'],
    ['10.1.2.3', 'RFC1918 /8'],
    ['172.16.9.9', 'RFC1918 /12'],
    ['192.168.1.10', 'RFC1918 /16'],
    ['169.254.1.1', 'link-local'],
    ['100.64.0.1', 'CGNAT'],
    ['::1', 'IPv6 loopback'],
    ['fd00::1', 'IPv6 ULA'],
    ['::ffff:127.0.0.1', 'IPv4-mapped loopback'],
  ];
  for (const [address, label] of optInGoverned) {
    const off = verdict(address, false);
    const on = verdict(address, true);
    check(`${label} (${address}) blocked when off`, off !== null, String(off));
    check(`${label} (${address}) allowed when on`, on === null, String(on));
  }

  const metadata = ['169.254.169.254', 'fd00:ec2::254', '100.100.100.200'];
  for (const address of metadata) {
    check(`metadata ${address} stays blocked when on`, verdict(address, true) !== null);
    check(`metadata ${address} stays blocked when off`, verdict(address, false) !== null);
  }

  const publicTargets = ['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111'];
  for (const address of publicTargets) {
    check(`public ${address} allowed when off`, verdict(address, false) === null);
    check(`public ${address} allowed when on`, verdict(address, true) === null);
  }

  // A malformed address must fail closed rather than slip through.
  check('malformed address fails closed', verdict('not-an-ip', true) !== null);
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

log(failures === 0 ? 'switch semantics verified against the real guard' : `${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
