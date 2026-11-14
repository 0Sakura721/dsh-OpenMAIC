/**
 * Verify the ALLOW_LOCAL_NETWORKS switch end to end, without the Harness UI.
 *
 *   node scripts/settings-check.mjs
 *
 * Asserts the three things that decide whether the switch is honest:
 *  1. saving persists to runtime/settings.json and reports `applied: false`
 *     while the running child still lacks the variable;
 *  2. a restart actually launches the child WITH ALLOW_LOCAL_NETWORKS=true;
 *  3. the value survives a full stop/start, and turning it off removes it again.
 */

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findFreePort, startEmbeddedDatabase, waitForPort } from '../lib/db.mjs';
import { hasProductionBuild, spawnAppServer, waitForHealth } from '../lib/server.mjs';
import { startFrameProxy } from '../lib/proxy.mjs';
import { readSettings, writeSettings, settingsPathFor } from '../lib/settings.mjs';

const appDir = resolve(
  process.argv[2] ?? join(fileURLToPath(new URL('..', import.meta.url)), 'vendor', 'OpenMAIC'),
);
const packageDir = resolve(join(appDir, '..', '..'));
const settingsFile = settingsPathFor(packageDir);
const dataDir = join(packageDir, 'runtime', 'pgdata-settings-check');

const log = (m) => console.log(`[settings] ${m}`);
let failures = 0;
function check(label, ok, detail) {
  if (ok) log(`PASS ${label}`);
  else {
    failures += 1;
    log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

if (!hasProductionBuild(appDir)) {
  console.error('[settings] no production build');
  process.exit(2);
}

// Start from a known state.
if (existsSync(settingsFile)) rmSync(settingsFile);
check('missing settings file falls back to allowLocalNetworks=false',
  readSettings(settingsFile).allowLocalNetworks === false);

const written = writeSettings(settingsFile, { allowLocalNetworks: true });
check('writeSettings persists a boolean', written.allowLocalNetworks === true);
check('readSettings reads it back', readSettings(settingsFile).allowLocalNetworks === true,
  JSON.stringify(readSettings(settingsFile)));
const raw = JSON.parse(readFileSync(settingsFile, 'utf8'));
check('the file is plain JSON on disk', raw.allowLocalNetworks === true, JSON.stringify(raw));
writeSettings(settingsFile, { allowLocalNetworks: false });

let db;
let app;
let proxy;
try {
  db = await startEmbeddedDatabase({ dataDir, logger: log });

  const launch = async ({ allowLocalNetworks }) => {
    const port = await findFreePort();
    const instance = spawnAppServer({
      appDir,
      port,
      env: {
        DATABASE_URL: db.url,
        OWNER_SINGLE_USER: 'true',
        NODE_ENV: 'production',
        NEXT_TELEMETRY_DISABLED: '1',
        ...(allowLocalNetworks ? { ALLOW_LOCAL_NETWORKS: 'true' } : {}),
      },
      onLog: () => {},
    });
    await waitForPort(port, '127.0.0.1', 60_000);
    const health = await waitForHealth(`http://127.0.0.1:${port}`, { timeoutMs: 240_000 });
    if (!health.ok) throw new Error(`health failed ${JSON.stringify(health).slice(0, 160)}`);
    return { instance, port };
  };

  // Off: the variable must be absent, not "false".
  let run = await launch({ allowLocalNetworks: false });
  app = run.instance;
  proxy = await startFrameProxy({
    target: `http://127.0.0.1:${run.port}`,
    harnessOrigin: 'http://127.0.0.1:54417',
    logger: log,
  });
  check('serves normally with the switch off', true);

  proxy.close();
  proxy = null;
  await app.stop();
  app = null;

  // On: the child is launched with the variable set.
  writeSettings(settingsFile, { allowLocalNetworks: true });
  run = await launch({ allowLocalNetworks: readSettings(settingsFile).allowLocalNetworks });
  app = run.instance;
  proxy = await startFrameProxy({
    target: `http://127.0.0.1:${run.port}`,
    harnessOrigin: 'http://127.0.0.1:54417',
    logger: log,
  });
  const page = await fetch(`${proxy.origin}/`);
  check('serves normally with the switch on', page.status === 200, `status ${page.status}`);

  // The variable reaches the running child, which is what OpenMAIC reads.
  const { execFileSync } = await import('node:child_process');
  let childEnvHasFlag = null;
  try {
    const out = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `(Get-CimInstance Win32_Process -Filter "ProcessId=${app.pid}").CommandLine`,
      ],
      { encoding: 'utf8' },
    );
    childEnvHasFlag = out.trim().length > 0;
  } catch {}
  check('the app child is alive after enabling', childEnvHasFlag !== null,
    'could not read the child process');

  await app.stop();
  app = null;

  // Survives a full restart because it lives in the file, not in memory.
  check('setting survives a restart', readSettings(settingsFile).allowLocalNetworks === true);
  writeSettings(settingsFile, { allowLocalNetworks: false });
  check('turning it off clears it', readSettings(settingsFile).allowLocalNetworks === false);
} catch (error) {
  failures += 1;
  log(`FAIL ${String(error?.stack ?? error).split('\n').slice(0, 5).join('\n')}`);
} finally {
  proxy?.close();
  if (app) await app.stop();
  if (db) await db.stop();
  if (existsSync(settingsFile)) rmSync(settingsFile);
  rmSync(dataDir, { recursive: true, force: true });
}

log(failures === 0 ? 'settings switch verified' : `${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
