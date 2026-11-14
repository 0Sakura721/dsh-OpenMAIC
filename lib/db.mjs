/**
 * Embedded PostgreSQL for dsh-openmaic.
 *
 * OpenMAIC refuses to boot without `DATABASE_URL` (courses, chat history,
 * learner progress and generated media all live in PostgreSQL). A "pure local"
 * plugin therefore has to ship the database too.
 *
 * We do that with PGlite (PostgreSQL compiled to WASM) plus `pglite-socket`,
 * which exposes the WASM database as a real PostgreSQL wire-protocol listener on
 * loopback. OpenMAIC's own `pg` driver then connects to `127.0.0.1:<port>`
 * exactly as it would to a server, and every migration and query runs unmodified.
 *
 * The data directory is persistent, so courses survive a Harness restart.
 *
 * Two documented PGlite limits apply and are reported honestly rather than
 * hidden:
 *  - LISTEN/NOTIFY does not round-trip through the socket layer. OpenMAIC's
 *    wakeup bus degrades to its fallback polling; correctness is unaffected
 *    because the durable event log stays the source of truth.
 *  - The socket server multiplexes one database over several connections, so
 *    long transactions from concurrent writers serialize.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { createServer, Socket } from 'node:net';

/** Ask the OS for a free loopback port. */
export function findFreePort(host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, host, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** Whether one TCP port accepts a connection right now. */
export function probePort(port, host = '127.0.0.1', timeoutMs = 700) {
  return new Promise((resolve) => {
    const socket = new Socket();
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

/** Wait until a TCP port accepts connections. */
export async function waitForPort(port, host = '127.0.0.1', timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probePort(port, host)) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

/**
 * Start the embedded database.
 *
 * Returns `{ url, port, dataDir, version, stop() }`. `stop()` is idempotent and
 * safe to call from a dispose path.
 */
export async function startEmbeddedDatabase({ dataDir, port, logger }) {
  let PGlite;
  let PGLiteSocketServer;
  try {
    ({ PGlite } = await import('@electric-sql/pglite'));
    ({ PGLiteSocketServer } = await import('@electric-sql/pglite-socket'));
  } catch (error) {
    throw new Error(
      'dsh-openmaic: the embedded database modules are missing. Install the plugin with its ' +
        'optional dependencies (`@electric-sql/pglite`, `@electric-sql/pglite-socket`), or point ' +
        `config.databaseUrl at an existing PostgreSQL. Cause: ${error?.message ?? error}`,
    );
  }

  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  logger?.(`dsh-openmaic: opening embedded PostgreSQL at ${dataDir}`);

  const db = await PGlite.create({ dataDir });
  const listenPort = port ?? (await findFreePort());
  const server = new PGLiteSocketServer({
    db,
    port: listenPort,
    host: '127.0.0.1',
    // OpenMAIC's pool plus the notify client need several connections at once.
    maxConnections: 24,
    idleTimeout: 0,
  });
  await server.start();

  const url = `postgres://postgres:postgres@127.0.0.1:${listenPort}/postgres`;
  let stopped = false;
  return {
    url,
    port: listenPort,
    dataDir,
    version: await db
      .query('show server_version')
      .then((r) => r.rows?.[0]?.server_version ?? 'unknown', () => 'unknown'),
    async stop() {
      if (stopped) return;
      stopped = true;
      try {
        await server.stop();
      } catch {}
      try {
        await db.close();
      } catch {}
    },
  };
}
