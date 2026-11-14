/**
 * Does the injected bridge actually reroute the app's runtime requests?
 *
 *   node scripts/bridge-check.mjs <harnessOrigin>
 *
 * The classroom displays but does not respond when every `fetch('/api/...')`
 * resolves against `about:srcdoc`'s null origin: the call leaves, no server answers,
 * and the click looks ignored. A `<base href>` cannot fix that — it only affects
 * relative resolution, and these paths are root-absolute.
 *
 * This asserts the repair at three levels, tightest first:
 *   1. the payload contains the bridge;
 *   2. inside the frame, `fetch('/api/health')` is rewritten to the proxy origin;
 *   3. that request actually returns the app's health JSON (HTTP 200 + status ok).
 */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const harness = process.argv[2];
if (!harness) {
  console.error('usage: node scripts/bridge-check.mjs <harnessOrigin>');
  process.exit(2);
}

const log = (m) => console.log(`[bridge] ${m}`);
let failures = 0;
const check = (label, ok, detail) => {
  if (ok) log(`PASS ${label}`);
  else {
    failures += 1;
    log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

const response = await fetch(`${harness}/api/dsh-openmaic/embed`);
if (!response.ok) {
  console.error(`[bridge] the Host refused the payload: HTTP ${response.status}`);
  process.exit(2);
}
const payload = await response.json();
const html = payload.html;
log(`payload: ${payload.bytes} bytes from ${payload.origin}`);

check('the payload carries the runtime bridge', /nativeFetch/.test(html), 'bridge script missing');
check('the payload carries a base element', /<base href="/.test(html));

const escaped = html.replace(/"/g, '&quot;');
const fixture = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:#0f1115}
  iframe{position:absolute;inset:0;width:100%;height:100%;border:0;background:#fff}
</style></head><body><iframe id="f" srcdoc="${escaped}"></iframe></body></html>`;

const server = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(fixture);
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const fixtureOrigin = `http://127.0.0.1:${server.address().port}`;
log(`fixture: ${fixtureOrigin}`);

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const profileDir = resolve(root, '.bridge-profile');
mkdirSync(profileDir, { recursive: true });
const port = 8500 + Math.floor(Math.random() * 200);

const browser = spawn(
  EDGE,
  [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--window-size=1200,860',
    'about:blank',
  ],
  { stdio: 'ignore', windowsHide: true },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(wsUrl) {
  const socket = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id).resolve(message);
      pending.delete(message.id);
    }
  });
  const ready = new Promise((done, fail) => {
    socket.addEventListener('open', done);
    socket.addEventListener('error', fail);
  });
  return {
    ready,
    send(method, params = {}) {
      const id = nextId;
      nextId += 1;
      return new Promise((done) => {
        pending.set(id, { resolve: done });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close: () => socket.close(),
  };
}

let cdp;
try {
  for (let i = 0; i < 80; i += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break;
    } catch {}
    await sleep(250);
  }
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  cdp = connect(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  await cdp.send('Page.navigate', { url: `${fixtureOrigin}/` });
  await sleep(9000);

  // Run the probe inside the frame, where the bridge lives and where the app's own
  // requests originate.
  const probe = await cdp.send('Runtime.evaluate', {
    expression: `(async () => {
      const f = document.getElementById('f');
      const w = f.contentWindow;
      const d = f.contentDocument;
      const out = { nodes: d ? d.body.querySelectorAll('*').length : 0 };
      // The bridge publishes an observable marker; reading a wrapper's source text
      // cannot tell a wrapped fetch apart from the native one.
      out.bridgeInstalled = !!(w.__dshOpenmaicBridge && typeof w.__dshOpenmaicBridge.abs === 'function');
      out.bridgeBase = w.__dshOpenmaicBridge ? w.__dshOpenmaicBridge.base : null;
      // What the repair produces for a root-absolute path.
      out.rewritten = w.__dshOpenmaicBridge ? w.__dshOpenmaicBridge.abs('/api/health') : null;
      // And whether the real call — through the wrapped fetch — succeeds.
      try {
        const r = await w.fetch('/api/health');
        out.status = r.status;
        const body = await r.json().catch(() => null);
        out.ok = body && body.status === 'ok';
      } catch (e) { out.error = String(e && e.message); }
      return JSON.stringify(out);
    })()`,
    returnByValue: true,
    awaitPromise: true,
  });
  const state = JSON.parse(probe.result?.result?.value ?? '{}');
  log(`frame nodes: ${state.nodes}`);
  log(`bridge installed: ${state.bridgeInstalled}`);
  log(`fetch('/api/health') became: ${state.rewritten}`);
  log(`response: HTTP ${state.status} status=${state.ok}`);

  check('the app booted inside the frame', (state.nodes ?? 0) > 100, `${state.nodes} nodes`);
  check('the bridge is installed', state.bridgeInstalled === true);
  check(
    'a root-absolute path is rewritten to the proxy origin',
    String(state.rewritten ?? '').startsWith(`${payload.origin}/api/`),
    String(state.rewritten ?? '(none)'),
  );
  check('the rewritten request reaches the app', state.status === 200, `HTTP ${state.status}`);
  check('the app answered with its health payload', state.ok === true, JSON.stringify(state.error ?? ''));

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const png = Buffer.from(shot.result.data, 'base64');
  const out = resolve(root, '.bridge-check.png');
  writeFileSync(out, png);
  log(`screenshot: ${out} (${Math.round(png.length / 1024)} KiB)`);
} catch (error) {
  failures += 1;
  log(`FAIL ${String(error?.stack ?? error).split('\n').slice(0, 4).join(' ')}`);
} finally {
  cdp?.close();
  try {
    browser.kill('SIGKILL');
  } catch {}
  server.close();
}

log(failures === 0 ? 'runtime bridge verified' : `${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
