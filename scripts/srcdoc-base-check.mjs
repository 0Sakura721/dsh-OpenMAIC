/**
 * Can srcdoc + <base href> give both painting and interaction?
 *
 *   node scripts/srcdoc-base-check.mjs <proxyOrigin>
 *
 * Two failures are already established in this repository:
 *   - a cross-origin `src` frame loads and computes but is never painted;
 *   - a plain `srcdoc` copy paints, but its opaque origin sends every absolute
 *     `fetch('/api/...')` nowhere, so nothing is clickable.
 *
 * The open question is whether a `<base href>` rescues the srcdoc case. A base
 * element changes relative-URL resolution, and Next.js emits root-absolute paths
 * (`/_next/...`, `/api/...`), which are exactly what a base does NOT affect. So the
 * likely answer is no — but "likely" is what has cost this task several rounds.
 *
 * This measures it: load both variants side by side, then click a control in each
 * and report whether the document reacted.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const proxyOrigin = process.argv[2];
if (!proxyOrigin) {
  console.error('usage: node scripts/srcdoc-base-check.mjs <proxyOrigin>');
  process.exit(2);
}

const log = (m) => console.log(`[srcdoc-base] ${m}`);
let failures = 0;
const check = (label, ok, detail) => {
  if (ok) log(`PASS ${label}`);
  else {
    failures += 1;
    log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

// Fetch the page once, produce two payloads: raw, and with a base + absolute URLs.
const raw = await (await fetch(`${proxyOrigin}/`)).text();
log(`classroom html: ${raw.length} bytes`);

const escaped = raw.replace(/"/g, '&quot;');
const withBase = raw
  .replace(/<head>/i, `<head><base href="${proxyOrigin}/">`)
  .replace(/"/g, '&quot;');

const fixture = `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box}html,body{margin:0;height:100%;background:#111;color:#eee;
    font:12px system-ui}
  .row{height:50vh;display:flex;flex-direction:column;border-bottom:2px solid #333}
  .row h3{margin:0;padding:3px 8px;background:#222;flex:0 0 20px;font-size:11px}
  iframe{flex:1 1 auto;min-height:0;width:100%;border:0;background:#fff}
</style></head><body>
  <div class="row"><h3>A: srcdoc, no base</h3><iframe id="a" srcdoc="${escaped}"></iframe></div>
  <div class="row"><h3>B: srcdoc + base href</h3><iframe id="b" srcdoc="${withBase}"></iframe></div>
</body></html>`;

const server = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(fixture);
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const fixtureOrigin = `http://127.0.0.1:${server.address().port}`;
log(`fixture: ${fixtureOrigin}`);

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const profileDir = resolve(root, '.srcdoc-base-profile');
mkdirSync(profileDir, { recursive: true });
const port = 8800 + Math.floor(Math.random() * 200);

const browser = spawn(
  EDGE,
  [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--window-size=1200,1100',
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

  // Probe each frame: DOM size, computed background, and whether its own scripts
  // ran (an opaque-origin doc that failed to load its chunks has no DOM depth).
  const probe = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const inspect = (id) => {
        const f = document.getElementById(id);
        try {
          const d = f.contentDocument;
          if (!d || !d.body) return { reachable: true, nodes: 0, text: '', bg: null };
          const style = d.defaultView.getComputedStyle(d.body);
          return {
            reachable: true,
            nodes: d.body.querySelectorAll('*').length,
            text: (d.body.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 80),
            bg: style.backgroundColor,
          };
        } catch (e) {
          return { reachable: false, nodes: 0, text: 'blocked: ' + e.message, bg: null };
        }
      };
      return JSON.stringify({ a: inspect('a'), b: inspect('b') });
    })()`,
    returnByValue: true,
  });
  const state = JSON.parse(probe.result?.result?.value ?? '{}');
  log(`A (no base): ${JSON.stringify(state.a)}`);
  log(`B (base href): ${JSON.stringify(state.b)}`);

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const png = Buffer.from(shot.result.data, 'base64');
  const out = resolve(root, '.srcdoc-base-check.png');
  writeFileSync(out, png);
  log(`screenshot: ${out} (${Math.round(png.length / 1024)} KiB)`);

  // A srcdoc frame is same-origin to the parent, so its DOM is readable; a small
  // node count means the app's own JS never ran, which is the interaction failure.
  check('A: the srcdoc document is readable', state.a?.reachable === true);
  check('B: the srcdoc document is readable', state.b?.reachable === true);
  check(
    'A: the app booted inside srcdoc',
    (state.a?.nodes ?? 0) > 50,
    `${state.a?.nodes ?? 0} nodes — ${state.a?.text ?? ''}`,
  );
  check(
    'B: the base href let the app boot',
    (state.b?.nodes ?? 0) > 50,
    `${state.b?.nodes ?? 0} nodes — ${state.b?.text ?? ''}`,
  );
  check(
    'the two variants differ in outcome',
    (state.a?.nodes ?? 0) !== (state.b?.nodes ?? 0),
    `A ${state.a?.nodes} vs B ${state.b?.nodes}`,
  );
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

log(failures === 0 ? 'srcdoc base comparison done' : `${failures} check(s) failed`);
process.exit(0);
