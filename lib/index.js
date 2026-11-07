/**
 * dsh-openmaic — Host half.
 *
 * Owns the whole local stack for THU-MAIC/OpenMAIC and keeps it invisible to the
 * rest of the Harness:
 *
 *   embedded PostgreSQL (PGlite over a loopback wire socket)
 *        ↓ DATABASE_URL
 *   `next start` child process on a free loopback port
 *        ↓ HTTP
 *   header-rewriting reverse proxy (so the Harness origin may frame it)
 *        ↓
 *   routes the browser half calls: status / start / stop / restart
 *
 * Nothing here imports OpenMAIC code. The checkout is spawned as its own
 * process, the database is a data directory, and both are torn down on dispose —
 * a crashed child never takes the Harness down with it.
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findFreePort, startEmbeddedDatabase, waitForPort } from './db.mjs';
import {
  configFiles,
  hasProductionBuild,
  probeHealth,
  readAppManifest,
  spawnAppServer,
  waitForHealth,
} from './server.mjs';
import { startFrameProxy } from './proxy.mjs';

export const name = 'dsh-openmaic';

const PLUGIN_ID = 'dsh-openmaic';
const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));

const ROUTE_BASE = '/api/dsh-openmaic';

/** Resolve the OpenMAIC checkout without forcing the user to configure it. */
function resolveAppDir(configured) {
  if (configured && configured.trim() !== '') return resolve(configured);
  const candidates = [
    join(PACKAGE_DIR, 'vendor', 'OpenMAIC'),
    join(homedir(), '.dsh', 'dsh-openmaic', 'OpenMAIC'),
  ];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'package.json'))) return candidate;
  }
  return candidates[0];
}

function state() {
  return {
    phase: 'stopped', // stopped | starting | running | stopping | failed
    appDir: null,
    appReady: false,
    appOrigin: null,
    panelOrigin: null,
    dbUrl: null,
    dbPort: null,
    dbManaged: false,
    dbVersion: null,
    dbDataDir: null,
    pid: null,
    error: null,
    startedAt: null,
    health: null,
    config: null,
  };
}

export function apply(ctx, config = {}) {
  const options = {
    autoStart: config.autoStart !== false,
    appDir: config.appDir ?? '',
    databaseUrl: config.databaseUrl ?? '',
    dataDir: config.dataDir ?? '',
    appPort: Number(config.appPort) || 0,
    proxyPort: Number(config.proxyPort) || 0,
    startupTimeoutMs: Number(config.startupTimeoutMs) || 300_000,
    extraEnv: config.env && typeof config.env === 'object' ? config.env : {},
  };

  const snapshot = state();
  snapshot.appDir = resolveAppDir(options.appDir);

  let db = null;
  let app = null;
  let proxy = null;
  let busy = null;
  let disposed = false;

  const logger = (message) => {
    try {
      const sink = typeof ctx?.logger === 'function' ? ctx.logger(PLUGIN_ID) : ctx?.logger;
      if (sink && typeof sink.info === 'function') sink.info(message);
      else console.info(message);
    } catch {}
  };
  const warn = (message) => {
    try {
      const sink = typeof ctx?.logger === 'function' ? ctx.logger(PLUGIN_ID) : ctx?.logger;
      if (sink && typeof sink.warn === 'function') sink.warn(message);
      else console.warn(message);
    } catch {}
  };

  const harnessOrigin = () => {
    try {
      const server = ctx.get('webServer');
      if (server && typeof server.getOrigin === 'function') return server.getOrigin();
    } catch {}
    return undefined;
  };

  const describe = () => ({
    ...snapshot,
    appManifest: readAppManifest(snapshot.appDir),
    files: configFiles(snapshot.appDir),
    hasBuild: hasProductionBuild(snapshot.appDir),
    platform: process.platform,
  });

  /** Bring the whole stack up. Serialized: concurrent callers share one promise. */
  function start() {
    if (busy) return busy;
    if (snapshot.phase === 'running') return Promise.resolve(describe());
    busy = (async () => {
      snapshot.phase = 'starting';
      snapshot.error = null;
      try {
        if (!existsSync(join(snapshot.appDir, 'package.json'))) {
          throw new Error(
            `OpenMAIC checkout not found at ${snapshot.appDir}. Run \`node scripts/setup-openmaic.mjs\` ` +
              'from the plugin repository, or set config.appDir to an existing checkout.',
          );
        }
        if (!hasProductionBuild(snapshot.appDir)) {
          throw new Error(
            `OpenMAIC has no production build at ${snapshot.appDir}/.next. Run \`pnpm build\` in the ` +
              'checkout first (scripts/setup-openmaic.mjs does it for you).',
          );
        }

        if (!db) {
          if (options.databaseUrl.trim() !== '') {
            snapshot.dbUrl = options.databaseUrl.trim();
            snapshot.dbManaged = false;
            logger(`dsh-openmaic: using the configured PostgreSQL`);
          } else {
            const dataDir =
              options.dataDir.trim() !== ''
                ? resolve(options.dataDir)
                : join(PACKAGE_DIR, 'runtime', 'pgdata');
            db = await startEmbeddedDatabase({ dataDir, logger });
            snapshot.dbUrl = db.url;
            snapshot.dbPort = db.port;
            snapshot.dbVersion = db.version;
            snapshot.dbDataDir = db.dataDir;
            snapshot.dbManaged = true;
            logger(`dsh-openmaic: embedded PostgreSQL ${db.version} on port ${db.port}`);
          }
        }

        if (!app) {
          const appPort = options.appPort || (await findFreePort());
          app = spawnAppServer({
            appDir: snapshot.appDir,
            port: appPort,
            env: {
              DATABASE_URL: snapshot.dbUrl,
              // Single-user local installation: one fixed owner, loopback only.
              OWNER_SINGLE_USER: 'true',
              NODE_ENV: 'production',
              NEXT_TELEMETRY_DISABLED: '1',
              ...options.extraEnv,
            },
            onLog: (line, level) => (level === 'stderr' ? warn(line) : logger(line)),
          });
          snapshot.pid = app.pid ?? null;
          snapshot.appOrigin = `http://127.0.0.1:${appPort}`;
          logger(`dsh-openmaic: starting OpenMAIC (pid ${app.pid}) on ${appPort}`);

          // A child that dies during boot must not leave a half-open state.
          app.exited.then((result) => {
            if (disposed) return;
            if (snapshot.phase === 'running') {
              snapshot.phase = 'failed';
              snapshot.error = `OpenMAIC exited unexpectedly (code ${result.code ?? 'null'})`;
              warn(`dsh-openmaic: ${snapshot.error}`);
            }
          });
        }

        const reachable = await waitForPort(Number(new URL(snapshot.appOrigin).port), '127.0.0.1', 60_000);
        if (!reachable) throw new Error('OpenMAIC did not open its port in time');

        const health = await waitForHealth(snapshot.appOrigin, {
          timeoutMs: options.startupTimeoutMs,
        });
        if (!health.ok) {
          throw new Error(
            `OpenMAIC is listening but /api/health never answered (${health.error ?? health.status}). ` +
              'Check the database URL and openmaic.yml.',
          );
        }
        snapshot.health = health.body ?? null;

        if (!proxy) {
          proxy = await startFrameProxy({
            target: snapshot.appOrigin,
            harnessOrigin: harnessOrigin(),
            port: options.proxyPort || 0,
            logger,
          });
          snapshot.panelOrigin = proxy.origin;
          snapshot.appOrigin = proxy.origin;
        }

        snapshot.phase = 'running';
        snapshot.startedAt = Date.now();
        snapshot.appReady = true;
        logger(`dsh-openmaic: ready at ${snapshot.panelOrigin}`);
        return describe();
      } catch (error) {
        snapshot.phase = 'failed';
        snapshot.error = String(error?.message ?? error);
        warn(`dsh-openmaic: startup failed — ${snapshot.error}`);
        return describe();
      } finally {
        busy = null;
      }
    })();
    return busy;
  }

  /** Tear the stack down in reverse order. */
  function stop() {
    if (busy) return busy;
    busy = (async () => {
      snapshot.phase = 'stopping';
      try {
        proxy?.close();
        proxy = null;
        if (app) {
          await app.stop();
          app = null;
        }
        if (db) {
          await db.stop();
          db = null;
        }
      } catch (error) {
        warn(`dsh-openmaic: stop failed — ${String(error?.message ?? error)}`);
      } finally {
        snapshot.phase = 'stopped';
        snapshot.appReady = false;
        snapshot.panelOrigin = null;
        snapshot.appOrigin = null;
        snapshot.pid = null;
        snapshot.health = null;
        snapshot.startedAt = null;
        busy = null;
      }
      return describe();
    })();
    return busy;
  }

  async function restart() {
    await stop();
    return start();
  }

  // ---------------------------------------------------------------- routes ---

  const json = (res, status, body) => {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(payload),
    });
    res.end(payload);
  };

  const readBody = (req) =>
    new Promise((resolveBody) => {
      let data = '';
      req.on('data', (chunk) => {
        data += chunk;
        if (data.length > 8192) req.destroy();
      });
      req.on('end', () => {
        try {
          resolveBody(data ? JSON.parse(data) : {});
        } catch {
          resolveBody({});
        }
      });
      req.on('error', () => resolveBody({}));
    });

  ctx.inject(['webServer'], (scoped) => {
    const webServer = scoped.get?.('webServer') ?? scoped.webServer;
    if (!webServer || typeof webServer.register !== 'function') return;

    scoped.effect(() => {
      const disposers = [];

      disposers.push(
        webServer.register({
          kind: 'exact',
          path: `${ROUTE_BASE}/status`,
          handler: async (req, res) => {
            if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' });
            try {
              if (snapshot.phase === 'running') {
                const live = await probeHealth(snapshot.appOrigin);
                snapshot.health = live.ok ? live.body ?? snapshot.health : snapshot.health;
                if (!live.ok) {
                  snapshot.phase = 'failed';
                  snapshot.error = 'OpenMAIC stopped answering /api/health';
                }
              }
              json(res, 200, describe());
            } catch (error) {
              json(res, 500, { error: String(error?.message ?? error) });
            }
          },
        }),
      );

      disposers.push(
        webServer.register({
          kind: 'exact',
          path: `${ROUTE_BASE}/start`,
          handler: async (req, res) => {
            if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
            await readBody(req);
            json(res, 200, await start());
          },
        }),
      );

      disposers.push(
        webServer.register({
          kind: 'exact',
          path: `${ROUTE_BASE}/stop`,
          handler: async (req, res) => {
            if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
            await readBody(req);
            json(res, 200, await stop());
          },
        }),
      );

      disposers.push(
        webServer.register({
          kind: 'exact',
          path: `${ROUTE_BASE}/restart`,
          handler: async (req, res) => {
            if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
            await readBody(req);
            json(res, 200, await restart());
          },
        }),
      );

      return () => {
        for (const dispose of disposers) {
          try {
            dispose();
          } catch {}
        }
      };
    });
  });

  // ----------------------------------------------------------------- tools ---

  ctx.inject(['tools'], (scoped) => {
    const tools = scoped.get?.('tools') ?? scoped.tools;
    if (!tools || typeof tools.register !== 'function') return;

    const schema = {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['status', 'start', 'stop', 'restart'],
          description: 'What to do with the local OpenMAIC classroom server.',
        },
      },
      required: ['action'],
      additionalProperties: false,
    };

    scoped.effect(() =>
      tools.register({
        name: 'openmaic_local',
        description:
          'Inspect or control the local OpenMAIC classroom server that this Harness profile runs ' +
          '(embedded PostgreSQL + Next.js). Use status to see whether it is running and on which ' +
          'loopback origin; start/stop/restart are idempotent.',
        parameters: schema,
        output: {
          schema: {
            type: 'object',
            properties: {
              phase: { type: 'string' },
              origin: { type: ['string', 'null'] },
              database: { type: ['string', 'null'] },
              error: { type: ['string', 'null'] },
            },
          },
          render: (_args, value) => [
            {
              type: 'text',
              text:
                `OpenMAIC: ${value?.phase ?? 'unknown'}` +
                (value?.origin ? `\nOrigin: ${value.origin}` : '') +
                (value?.database ? `\nDatabase: ${value.database}` : '') +
                (value?.error ? `\nError: ${value.error}` : ''),
            },
          ],
        },
        async execute(args) {
          const action = String(args?.action ?? 'status');
          if (action === 'start') await start();
          else if (action === 'stop') await stop();
          else if (action === 'restart') await restart();
          else if (snapshot.phase === 'running') {
            const live = await probeHealth(snapshot.appOrigin);
            if (!live.ok) snapshot.phase = 'failed';
          }
          return {
            phase: snapshot.phase,
            origin: snapshot.panelOrigin,
            database: snapshot.dbManaged ? `embedded PostgreSQL ${snapshot.dbVersion ?? ''}`.trim() : snapshot.dbUrl ? 'external PostgreSQL' : null,
            error: snapshot.error,
          };
        },
      }),
    );
  });

  // -------------------------------------------------------------- lifetime ---

  ctx.effect(() => {
    if (options.autoStart) {
      // Fire and forget: a slow first build must not block Host startup.
      start().catch((error) => warn(`dsh-openmaic: auto start failed — ${error}`));
    }
    return () => {
      disposed = true;
      void stop();
    };
  });

  logger(`dsh-openmaic: mounted (appDir ${snapshot.appDir})`);
}

export default { name, apply };
