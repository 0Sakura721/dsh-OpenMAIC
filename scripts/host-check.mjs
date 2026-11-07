/**
 * Load the Host half against a fake Cordis context.
 *
 * This is the closest thing to a Harness boot that can run outside the Harness:
 * it proves that `apply()` resolves services through `ctx.inject`, registers its
 * four routes and its agent tool with the real signatures, and drives the stack
 * from `stopped` to `running` without throwing.
 *
 *   node scripts/host-check.mjs
 */

import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const entry = pathToFileURL(join(fileURLToPath(new URL('..', import.meta.url)), 'lib', 'index.js')).href;

const routes = new Map();
const tools = new Map();
const effects = [];
let disposedRoutes = 0;

const webServer = {
  register(route) {
    routes.set(route.path, route);
    return () => {
      routes.delete(route.path);
      disposedRoutes += 1;
    };
  },
  getOrigin: () => 'http://127.0.0.1:54417',
};

const toolRegistry = {
  register(definition) {
    tools.set(definition.name, definition);
    return () => tools.delete(definition.name);
  },
};

const services = { webServer, tools: toolRegistry };

const ctx = {
  logger() {
    return { info: (m) => console.log(`[log] ${m}`), warn: (m) => console.log(`[warn] ${m}`) };
  },
  get: (key) => services[key],
  inject(deps, callback) {
    const available = deps.every((dep) => services[dep] !== undefined);
    if (available) callback(ctx);
    return () => {};
  },
  effect(factory) {
    const dispose = factory();
    effects.push(dispose);
    return dispose;
  },
};

const mod = await import(entry);
if (typeof mod.apply !== 'function') throw new Error('lib/index.js exports no apply()');
console.log(`plugin name: ${mod.name}`);

mod.apply(ctx, { autoStart: true, startupTimeoutMs: 300_000 });

const expected = ['/api/dsh-openmaic/status', '/api/dsh-openmaic/start', '/api/dsh-openmaic/stop', '/api/dsh-openmaic/restart'];
for (const path of expected) {
  if (!routes.has(path)) throw new Error(`route not registered: ${path}`);
  console.log(`route ok: ${path}`);
}
if (!tools.has('openmaic_local')) throw new Error('agent tool not registered');
console.log('tool ok: openmaic_local');

// Drive it to running through the real HTTP-ish handler.
let waited = 0;
let status;
while (waited < 240_000) {
  status = await call('status');
  if (status.phase === 'running' || status.phase === 'failed') break;
  await new Promise((r) => setTimeout(r, 2000));
  waited += 2000;
}
console.log(`phase: ${status?.phase}`);

if (status?.phase !== 'running') {
  console.log(JSON.stringify(status, null, 2).slice(0, 2000));
  throw new Error('the local stack did not reach running');
}

console.log(`origin: ${status.panelOrigin}`);
console.log(`database: ${status.dbManaged ? `embedded ${status.dbVersion}` : 'external'}`);
console.log(`pid: ${status.pid}`);

const response = await fetch(`${status.panelOrigin}/api/health`);
const body = await response.json();
console.log(`framed health: ${response.status} ${body?.status ?? ''}`);

const page = await fetch(`${status.panelOrigin}/`);
console.log(`page: ${page.status}`);
console.log(`csp: ${page.headers.get('content-security-policy')}`);

if (!(page.headers.get('content-security-policy') ?? '').includes('54417')) {
  throw new Error('the proxy did not admit the Harness origin');
}

const stoppedResult = await call('stop');
console.log(`after stop: ${stoppedResult.phase}`);
for (const dispose of effects) {
  try {
    await dispose?.();
  } catch {}
}
console.log('host half verified');

/** Invoke a route the way the web server would. */
async function call(action) {
  const route = routes.get(`/api/dsh-openmaic/${action}`);
  let payload = '';
  const res = {
    writeHead() {},
    end(chunk) {
      payload += chunk;
    },
  };
  // A real IncomingMessage always ends; the fixture must too, or readBody waits
  // forever and the stop route never answers.
  const listeners = new Map();
  const req = {
    method: action === 'status' ? 'GET' : 'POST',
    on(event, handler) {
      listeners.set(event, handler);
      if (event === 'end') setImmediate(() => handler());
      return req;
    },
    destroy() {},
  };
  await route.handler(req, res);
  return JSON.parse(payload);
}
