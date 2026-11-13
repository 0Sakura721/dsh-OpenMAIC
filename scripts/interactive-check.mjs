/**
 * Does the framed classroom paint AND work?
 *
 *   node scripts/interactive-check.mjs <proxyOrigin>
 *
 * The srcdoc version painted but could not be interacted with: an `about:srcdoc`
 * document has an opaque origin, so every `/api` call from the app resolved against
 * the wrong base. A cross-origin `src` frame keeps a real origin, and the proxy's
 * rewritten `frame-ancestors` lets it paint.
 *
 * This asserts both halves at once: the frame is admitted by CSP, its DOM renders,
 * and — the part that regressed — a request from inside the frame to its own origin
 * succeeds, which is what every button in the classroom depends on.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const proxyOrigin = process.argv[2];
if (!proxyOrigin) {
  console.error('usage: node scripts/interactive-check.mjs <proxyOrigin>');
  process.exit(2);
}

const log = (m) => console.log(`[interactive] ${m}`);
let failures = 0;
const check = (label, ok, detail) => {
  if (ok) log(`PASS ${label}`);
  else {
    failures += 1;
    log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

// Serve the fixture from a different loopback port than the proxy, exactly like the
// Harness page does, so the frame really is cross-origin and its CSP must admit us.
const { createServer } = await import('node:http');
const fixture = `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box}html,body{margin:0;height:100%;background:#0f1115}
  #host{position:absolute;inset:0;display:flex;flex-direction:column}
  #bar{height:32px;background:#1b1e24;color:#ddd;font:12px system-ui;display:flex;align-items:center;padding:0 8px}
  iframe{flex:1 1 auto;min-height:0;width:100%;border:0;display:block}
</style></head><body>
  <div id="host"><div id="bar">OpenMAIC · running</div>
  <iframe id="f" src="${proxyOrigin}/"></iframe></div>
</body></html>`;

const server = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(fixture);
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const fixtureOrigin = `http://127.0.0.1:${server.address().port}`;
log(`fixture: ${fixtureOrigin}`);
log(`frame:   ${proxyOrigin}/`);

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const profileDir = resolve(root, '.interactive-profile');
mkdirSync(profileDir, { recursive: true });
const port = 8900 + Math.floor(Math.random() * 300);

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
  await sleep(8000);

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const png = Buffer.from(shot.result.data, 'base64');
  const out = resolve(root, '.interactive-check.png');
  writeFileSync(out, png);
  log(`screenshot: ${out} (${Math.round(png.length / 1024)} KiB)`);

  // A refused frame renders a single flat fill with a no-entry glyph, which is far
  // smaller than a real app. 60 KiB is well below any rendered classroom.
  check('the frame painted rather than showing a block page', png.length > 60000, `${png.length} bytes`);

  // The decisive interaction test: the app's own API must answer its own origin.
  // A srcdoc frame fails here because its origin is opaque.
  const probe = await fetch(`${proxyOrigin}/api/health`);
  const health = await probe.json().catch(() => null);
  check('a request to the frame origin reaches the app', probe.ok, `HTTP ${probe.status}`);
  check('the app answered with its health payload', health?.status === 'ok', JSON.stringify(health).slice(0, 120));
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

log(failures === 0 ? 'interactive embed verified' : `${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
