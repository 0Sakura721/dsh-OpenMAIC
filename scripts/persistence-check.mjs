/**
 * Persistence round-trip through the plugin's real lifecycle.
 *
 * Proves the thing a user actually cares about: a classroom folder written
 * through the proxied origin is really stored in the embedded PostgreSQL and is
 * still there after the plugin's own stop → start cycle (which closes the PGlite
 * instance and reopens the same data directory).
 *
 *   node scripts/persistence-check.mjs
 */

import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findFreePort, startEmbeddedDatabase, waitForPort } from '../lib/db.mjs';
import { hasProductionBuild, spawnAppServer, waitForHealth } from '../lib/server.mjs';
import { startFrameProxy } from '../lib/proxy.mjs';

const appDir = resolve(
  process.argv[2] ?? join(fileURLToPath(new URL('..', import.meta.url)), 'vendor', 'OpenMAIC'),
);
const dataDir = join(appDir, '..', '..', 'runtime', 'pgdata-persistence');
const log = (m) => console.log(`[persistence] ${m}`);

let failures = 0;
function check(label, ok, detail) {
  if (ok) log(`PASS ${label}`);
  else {
    failures += 1;
    log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

if (!hasProductionBuild(appDir)) {
  console.error('[persistence] no production build; run pnpm build in the checkout first');
  process.exit(2);
}

const cookieJar = new Map();
function remember(response) {
  const raw = response.headers.getSetCookie?.() ?? [];
  for (const line of raw) {
    const [pair] = line.split(';');
    const index = pair.indexOf('=');
    if (index > 0) cookieJar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
  }
}
async function api(base, path, init = {}) {
  const cookie = [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
    },
  });
  remember(response);
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text.slice(0, 400);
  }
  return { status: response.status, body };
}

/** Bring the whole stack up, exactly as lib/index.js does. */
async function up() {
  const database = await startEmbeddedDatabase({ dataDir, logger: log });
  const port = await findFreePort();
  const server = spawnAppServer({
    appDir,
    port,
    env: {
      DATABASE_URL: database.url,
      OWNER_SINGLE_USER: 'true',
      NODE_ENV: 'production',
      NEXT_TELEMETRY_DISABLED: '1',
    },
    onLog: (line) => {
      if (/\[ERROR\]|FATAL/.test(line)) log(`app: ${line}`);
    },
  });
  if (!(await waitForPort(port, '127.0.0.1', 60_000))) throw new Error('server port never opened');
  const health = await waitForHealth(`http://127.0.0.1:${port}`, { timeoutMs: 240_000 });
  if (!health.ok) throw new Error(`health failed ${JSON.stringify(health).slice(0, 200)}`);
  const frame = await startFrameProxy({
    target: `http://127.0.0.1:${port}`,
    harnessOrigin: 'http://127.0.0.1:54417',
    logger: log,
  });
  return {
    origin: frame.origin,
    async down() {
      frame.close();
      await server.stop();
      await database.stop();
    },
  };
}

const marker = `dsh-openmaic-persist-${Date.now()}`;
let stack;
try {
  stack = await up();
  log(`stack up at ${stack.origin} (database ${dataDir})`);

  const created = await api(stack.origin, '/api/folders', {
    method: 'POST',
    body: JSON.stringify({ name: marker }),
  });
  check('folder create accepted', created.status === 200 || created.status === 201,
    `status ${created.status} ${JSON.stringify(created.body).slice(0, 200)}`);

  const listed = await api(stack.origin, '/api/folders');
  check('folder reads back in the same run', JSON.stringify(listed.body).includes(marker),
    `status ${listed.status}`);

  await stack.down();
  stack = null;
  log('plugin stop() done; bringing the stack back up on the same data directory…');

  stack = await up();
  const afterRestart = await api(stack.origin, '/api/folders');
  check('row survived the stop/start cycle', JSON.stringify(afterRestart.body).includes(marker),
    `status ${afterRestart.status} ${JSON.stringify(afterRestart.body).slice(0, 240)}`);
} catch (error) {
  failures += 1;
  log(`FAIL ${String(error?.message ?? error)}`);
} finally {
  if (stack) await stack.down();
}

log(failures === 0 ? 'persistence verified' : `${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
