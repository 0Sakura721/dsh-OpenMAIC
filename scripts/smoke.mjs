/**
 * End-to-end smoke test for the local stack, run without the Harness.
 *
 *   node scripts/smoke.mjs
 *
 * Starts the embedded database, the OpenMAIC server and the frame proxy exactly
 * as the plugin does, then asserts health, a framed page, and the rewritten
 * headers. Exits non-zero on the first failed assertion.
 */

import { hasProductionBuild } from '../lib/server.mjs';
import { findFreePort, startEmbeddedDatabase, waitForPort } from '../lib/db.mjs';
import { probeHealth, spawnAppServer, waitForHealth } from '../lib/server.mjs';
import { startFrameProxy } from '../lib/proxy.mjs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = resolve(process.argv[2] ?? join(fileURLToPath(new URL('..', import.meta.url)), 'vendor', 'OpenMAIC'));

const log = (message) => console.log(`[smoke] ${message}`);
let failures = 0;
function check(label, condition, detail) {
  if (condition) log(`PASS ${label}`);
  else {
    failures += 1;
    log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

if (!hasProductionBuild(appDir)) {
  console.error(`[smoke] no production build in ${appDir}; run pnpm build there first`);
  process.exit(2);
}

let db;
let app;
let proxy;
try {
  const dbDataDir = join(appDir, '..', '..', 'runtime', 'pgdata-smoke');
  log('starting embedded PostgreSQL…');
  db = await startEmbeddedDatabase({ dataDir: dbDataDir, logger: log });
  log(`database ${db.version} on ${db.port}`);

  const port = await findFreePort();
  log(`starting OpenMAIC on ${port}…`);
  app = spawnAppServer({
    appDir,
    port,
    env: {
      DATABASE_URL: db.url,
      OWNER_SINGLE_USER: 'true',
      NODE_ENV: 'production',
      NEXT_TELEMETRY_DISABLED: '1',
    },
    onLog: (line) => log(`app: ${line}`),
  });

  check('app port opens', await waitForPort(port, '127.0.0.1', 60_000));
  const health = await waitForHealth(`http://127.0.0.1:${port}`, { timeoutMs: 240_000 });
  check('health endpoint reports ok', health.ok === true, JSON.stringify(health).slice(0, 300));

  proxy = await startFrameProxy({
    target: `http://127.0.0.1:${port}`,
    harnessOrigin: 'http://127.0.0.1:54417',
    logger: log,
  });
  log(`proxy on ${proxy.origin}`);

  const proxiedHealth = await probeHealth(proxy.origin);
  check('proxy forwards health', proxiedHealth.ok === true);

  const page = await fetch(`${proxy.origin}/`, { redirect: 'manual' });
  const csp = page.headers.get('content-security-policy') ?? '';
  check('page responds', page.status === 200 || page.status === 307, `status ${page.status}`);
  check('frame-ancestors admits the harness origin', csp.includes('http://127.0.0.1:54417'), csp);
  check('x-frame-options removed', page.headers.get('x-frame-options') === null);
  const html = await page.text();
  check('page is HTML', html.trimStart().toLowerCase().startsWith('<!doctype html') || html.includes('<html'));
} finally {
  proxy?.close();
  if (app) await app.stop();
  if (db) await db.stop();
}

log(failures === 0 ? 'all checks passed' : `${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
