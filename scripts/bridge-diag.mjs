/**
 * Diagnose why the injected bridge did not take effect.
 *
 *   node scripts/bridge-diag.mjs <harnessOrigin>
 *
 * The payload certainly contains the bridge (offset 276, right after `<base>`), and
 * the frame certainly boots (224 nodes), yet `fetch('/api/health')` still leaves as
 * a root-absolute path. Something between the script tag and the call undoes it.
 *
 * This captures console output from inside the frame, inspects what `window.fetch`
 * actually is at runtime, and checks whether the app replaced it afterwards.
 */

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const harness = process.argv[2];
if (!harness) {
  console.error('usage: node scripts/bridge-diag.mjs <harnessOrigin>');
  process.exit(2);
}

const log = (m) => console.log(`[diag] ${m}`);

const response = await fetch(`${harness}/api/dsh-openmaic/embed`);
const payload = await response.json();
const html = payload.html;

const escaped = html.replace(/"/g, '&quot;');
const fixture = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<iframe id="f" style="width:1100px;height:800px;border:0" srcdoc="${escaped}"></iframe>
</body></html>`;

const server = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(fixture);
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const fixtureOrigin = `http://127.0.0.1:${server.address().port}`;

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const profileDir = resolve(root, '.diag-profile');
mkdirSync(profileDir, { recursive: true });
const port = 8400 + Math.floor(Math.random() * 200);

const browser = spawn(
  EDGE,
  [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
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
  cdp = connect(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');

  await cdp.send('Page.navigate', { url: `${fixtureOrigin}/` });
  await sleep(9000);

  const probe = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const f = document.getElementById('f');
      const w = f.contentWindow;
      const out = {};
      // Is the wrapper present, and does it carry our marker?
      const src = String(w.fetch);
      out.fetchSourceHead = src.slice(0, 120);
      out.fetchLooksWrapped = /BASE|abs\\(/.test(src);
      out.fetchLength = src.length;
      // Does the base element exist and what does the browser think the base is?
      const d = f.contentDocument;
      out.hasBase = !!d.querySelector('base');
      out.baseHref = d.querySelector('base')?.href ?? null;
      // What does the platform resolve a root-absolute path against?
      try { out.resolvedApi = new URL('/api/health', d.baseURI).href; } catch (e) { out.resolvedApi = 'err'; }
      out.baseURI = d.baseURI;
      // Is our marker function still reachable?
      out.hasMarker = typeof w.__dshOpenmaicBridge === 'function';
      return JSON.stringify(out);
    })()`,
    returnByValue: true,
  });
  const state = JSON.parse(probe.result?.result?.value ?? '{}');
  for (const [k, v] of Object.entries(state)) log(`${k}: ${JSON.stringify(v)}`);

  const problems = cdp.events
    .filter((e) => e.method === 'Log.entryAdded' && e.params.entry.level === 'error')
    .map((e) => e.params.entry.text)
    .slice(0, 6);
  for (const line of problems) log(`console error: ${line}`);

  const exceptions = cdp.events
    .filter((e) => e.method === 'Runtime.exceptionThrown')
    .map((e) => e.params.exceptionDetails?.text ?? '')
    .slice(0, 6);
  for (const line of exceptions) log(`exception: ${line}`);
} catch (error) {
  log(`FAIL ${String(error?.stack ?? error).split('\n').slice(0, 4).join(' ')}`);
} finally {
  cdp?.close();
  try {
    browser.kill('SIGKILL');
  } catch {}
  server.close();
}

process.exit(0);
