/**
 * Click a real control inside the embedded classroom and see whether anything happens.
 *
 *   node scripts/click-check.mjs <harnessOrigin>
 *
 * Everything measured so far proves the *transport* works: the frame boots, the
 * bridge rewrites paths, and a hand-made `fetch('/api/health')` returns 200. None of
 * that proves a click has any effect, and the user reports the page is inert, so the
 * remaining question is about event handling, not requests.
 *
 * This drives a real click through CDP's input pipeline (not `element.click()`,
 * which bypasses hit-testing and pointer events) and reports what changed.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const harness = process.argv[2];
if (!harness) {
  console.error('usage: node scripts/click-check.mjs <harnessOrigin>');
  process.exit(2);
}

const log = (m) => console.log(`[click] ${m}`);
let failures = 0;
const check = (label, ok, detail) => {
  if (ok) log(`PASS ${label}`);
  else {
    failures += 1;
    log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

const payload = await (await fetch(`${harness}/api/dsh-openmaic/embed`)).json();
const html = payload.html;
log(`payload: ${payload.bytes} bytes from ${payload.origin}`);

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
const profileDir = resolve(root, '.click-profile');
mkdirSync(profileDir, { recursive: true });
const port = 8300 + Math.floor(Math.random() * 200);

const browser = spawn(
  EDGE,
  [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--window-size=1200,900',
    'about:blank',
  ],
  { stdio: 'ignore', windowsHide: true },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(wsUrl) {
  const socket = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  const events = [];
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id).resolve(message);
      pending.delete(message.id);
    } else if (message.method) events.push(message);
  });
  const ready = new Promise((done, fail) => {
    socket.addEventListener('open', done);
    socket.addEventListener('error', fail);
  });
  return {
    ready,
    events,
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
  const iframeTarget = targets.find((t) => t.type === 'iframe');
  log(`targets: ${targets.map((t) => t.type).join(', ')}`);

  cdp = connect(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');

  await cdp.send('Page.navigate', { url: `${fixtureOrigin}/` });
  await sleep(9000);

  // Locate a control to click, and record the DOM before it.
  const before = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const d = document.getElementById('f').contentDocument;
      const w = document.getElementById('f').contentWindow;
      const buttons = [...d.querySelectorAll('button')].filter((b) => {
        const r = b.getBoundingClientRect();
        return r.width > 10 && r.height > 10;
      });
      const pick = buttons.find((b) => /配置模型/.test(b.textContent || ''))
        ?? buttons.find((b) => /深度交互/.test(b.textContent || ''))
        ?? buttons[0];
      if (!pick) return JSON.stringify({ found: false, count: 0 });
      const r = pick.getBoundingClientRect();
      const hostRect = document.getElementById('f').getBoundingClientRect();
      return JSON.stringify({
        found: true,
        count: buttons.length,
        label: (pick.textContent || '').trim().slice(0, 20),
        // Frame-relative coordinates, then page coordinates for CDP input.
        x: Math.round(hostRect.left + r.left + r.width / 2),
        y: Math.round(hostRect.top + r.top + r.height / 2),
        nodes: d.body.querySelectorAll('*').length,
        listeners: typeof w.__dshOpenmaicBridge === 'object',
      });
    })()`,
    returnByValue: true,
  });
  const info = JSON.parse(before.result?.result?.value ?? '{}');
  log(`controls found: ${info.count}, picking "${info.label}" at (${info.x}, ${info.y})`);
  log(`nodes before: ${info.nodes}`);

  check('the frame has clickable controls', (info.count ?? 0) > 0, `${info.count} buttons`);
  check('a target control was located', info.found === true);

  if (info.found) {
    // A real pointer press/release, so hit-testing and pointer events run exactly as
    // they would for the user. `element.click()` would skip both.
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: info.x,
      y: info.y,
      button: 'none',
    });
    await sleep(120);
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: info.x,
      y: info.y,
      button: 'left',
      clickCount: 1,
    });
    await sleep(80);
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: info.x,
      y: info.y,
      button: 'left',
      clickCount: 1,
    });
    await sleep(2500);

    const after = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const f = document.getElementById('f');
        const d = f.contentDocument;
        const dialogs = d.querySelectorAll('[role="dialog"],[data-state="open"]').length;
        return JSON.stringify({
          nodes: d.body.querySelectorAll('*').length,
          dialogs,
          url: f.contentWindow.location.href.slice(0, 60),
        });
      })()`,
      returnByValue: true,
    });
    const post = JSON.parse(after.result?.result?.value ?? '{}');
    log(`nodes after: ${post.nodes}, dialogs: ${post.dialogs}`);

    check(
      'the click changed the DOM',
      post.nodes !== info.nodes,
      `before ${info.nodes}, after ${post.nodes}`,
    );
    check('the click opened a dialog or panel', (post.dialogs ?? 0) > 0, `${post.dialogs} dialogs`);
  }

  const problems = cdp.events
    .filter((e) => e.method === 'Log.entryAdded' && e.params.entry.level === 'error')
    .map((e) => e.params.entry.text)
    .slice(0, 8);
  for (const line of problems) log(`console: ${line}`);

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const png = Buffer.from(shot.result.data, 'base64');
  const out = resolve(root, '.click-check.png');
  writeFileSync(out, png);
  log(`screenshot: ${out}`);
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

log(failures === 0 ? 'click verified' : `${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
