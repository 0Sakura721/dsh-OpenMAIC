/**
 * Child-process supervisor for the OpenMAIC Next.js server.
 *
 * The plugin never imports OpenMAIC: it spawns it in the checkout as its own
 * process, streams its output into the Harness log, watches the health endpoint,
 * and kills the tree on dispose. Keeping the app out of the Harness process is
 * what makes an unclean shutdown of either side survivable.
 *
 * OpenMAIC builds with `output: 'standalone'`, so `next start` is unsupported
 * there (it prints a warning and serves an app without its static assets). We
 * therefore prefer `node .next/standalone/server.js`, after mirroring
 * `.next/static` and `public` into the standalone tree exactly the way the
 * project's Dockerfile does. A checkout without a standalone tree falls back to
 * the Next CLI so a plain `next build` also works.
 */

import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Locate the Next.js CLI that ships inside the checkout. */
export function nextCliPath(appDir) {
  const candidates = [
    join(appDir, 'node_modules', 'next', 'dist', 'bin', 'next'),
    join(appDir, 'node_modules', 'next', 'dist', 'bin', 'next.js'),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

/** Read `package.json` of the checkout, when it exists. */
export function readAppManifest(appDir) {
  const file = join(appDir, 'package.json');
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** True when the checkout has a finished production build. */
export function hasProductionBuild(appDir) {
  const required = [
    join(appDir, '.next', 'BUILD_ID'),
    join(appDir, '.next', 'server'),
    join(appDir, '.next', 'static'),
  ];
  return required.every((p) => existsSync(p));
}

/** Path of the standalone server entry, when the build produced one. */
export function standaloneServerPath(appDir) {
  const file = join(appDir, '.next', 'standalone', 'server.js');
  return existsSync(file) ? file : null;
}

/**
 * Mirror `.next/static` and `public` into the standalone tree.
 *
 * A standalone build does not copy either: the Dockerfile does it in a separate
 * layer. Without this the server renders HTML that references assets it cannot
 * serve, which looks like a blank page rather than an error.
 */
export function prepareStandalone(appDir, logger) {
  const root = join(appDir, '.next', 'standalone');
  if (!existsSync(root)) return false;
  const pairs = [
    [join(appDir, '.next', 'static'), join(root, '.next', 'static')],
    [join(appDir, 'public'), join(root, 'public')],
  ];
  for (const [from, to] of pairs) {
    if (!existsSync(from)) continue;
    try {
      const toStat = existsSync(to) ? statSync(to) : null;
      const fromStat = statSync(from);
      if (toStat && toStat.mtimeMs >= fromStat.mtimeMs) continue;
      mkdirSync(join(to, '..'), { recursive: true });
      cpSync(from, to, { recursive: true, force: true });
      logger?.(`dsh-openmaic: mirrored ${from} -> ${to}`);
    } catch (error) {
      logger?.(`dsh-openmaic: could not mirror ${from} — ${String(error?.message ?? error)}`);
    }
  }
  return true;
}

/** `openmaic.yml` / `.env.local` presence, for the status card. */
export function configFiles(appDir) {
  return {
    yml: existsSync(join(appDir, 'openmaic.yml')),
    envLocal: existsSync(join(appDir, '.env.local')),
    buildId: existsSync(join(appDir, '.next', 'BUILD_ID'))
      ? readFileSync(join(appDir, '.next', 'BUILD_ID'), 'utf8').trim()
      : null,
  };
}

/**
 * Spawn the OpenMAIC server.
 *
 * Returns a handle with `port`, `pid`, `mode`, `stop()` and an `exited` promise.
 * Output lines go to `onLog`; the caller decides where they land.
 */
export function spawnAppServer({ appDir, port, env, onLog, nodeExecutable = process.execPath }) {
  const passthrough = {
    ...process.env,
    ...env,
    PORT: String(port),
    HOSTNAME: '127.0.0.1',
  };

  let command;
  let args;
  let cwd;
  let mode;
  const standalone = standaloneServerPath(appDir);
  if (standalone) {
    prepareStandalone(appDir, (line) => onLog?.(line, 'stdout'));
    command = nodeExecutable;
    args = [standalone];
    cwd = join(appDir, '.next', 'standalone');
    mode = 'standalone';
  } else {
    const cli = nextCliPath(appDir);
    if (!cli) {
      throw new Error(`dsh-openmaic: neither a standalone server nor the Next.js CLI exists in ${appDir}`);
    }
    command = nodeExecutable;
    args = [cli, 'start', '--port', String(port), '--hostname', '127.0.0.1'];
    cwd = appDir;
    mode = 'next-cli';
  }

  const child = spawn(command, args, {
    cwd,
    env: passthrough,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const pump = (stream, level) => {
    let buffer = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).replace(/\r$/, '');
        buffer = buffer.slice(index + 1);
        if (line.trim() !== '') onLog?.(line, level);
      }
    });
    stream.on('end', () => {
      if (buffer.trim() !== '') onLog?.(buffer.trim(), level);
      buffer = '';
    });
  };
  pump(child.stdout, 'stdout');
  pump(child.stderr, 'stderr');

  const exited = new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
    child.once('error', (error) => resolve({ code: null, signal: null, error }));
  });

  let stopping = null;
  return {
    pid: child.pid,
    port,
    mode,
    exited,
    stop() {
      if (stopping) return stopping;
      stopping = (async () => {
        if (child.exitCode !== null || child.signalCode !== null) return;
        try {
          if (process.platform === 'win32') {
            spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
              windowsHide: true,
              stdio: 'ignore',
            });
          } else {
            child.kill('SIGTERM');
          }
        } catch {}
        const timeout = new Promise((r) => setTimeout(() => r('timeout'), 8000));
        const result = await Promise.race([exited, timeout]);
        if (result === 'timeout') {
          try {
            child.kill('SIGKILL');
          } catch {}
        }
      })();
      return stopping;
    },
  };
}

/** Probe OpenMAIC's health endpoint. */
export async function probeHealth(url, timeoutMs = 2500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/api/health`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return { ok: false, status: response.status };
    const body = await response.json().catch(() => null);
    return { ok: true, status: response.status, body };
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) };
  } finally {
    clearTimeout(timer);
  }
}

/** Wait until the health endpoint answers, or the timeout expires. */
export async function waitForHealth(url, { timeoutMs = 180_000, intervalMs = 1500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await probeHealth(url);
    if (last.ok) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return last ?? { ok: false, error: 'timed out' };
}
