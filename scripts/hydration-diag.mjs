/**
 * Why does a rendered-but-inert classroom fail to hydrate?
 *
 *   node scripts/hydration-diag.mjs <harnessOrigin>
 *
 * Measured: the frame holds 224 nodes and 12 buttons, yet a real pointer click
 * changes nothing and opens nothing. That is the signature of server HTML that
 * never hydrated — React attached no listeners — so the question is what stopped
 * hydration, not what stopped requests.
 *
 * This records every load failure, script error and console error inside the frame,
 * and reports whether React's root actually mounted.
 */

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const harness = process.argv[2];
if (!harness) {
  console.error('usage: node scripts/hydration-diag.mjs <harnessOrigin>');
  process.exit(2);
}

const log = (m) => console.log(`[hyd] ${m}`);

const payload = await (await fetch(`${harness}/api/dsh-openmaic/embed`)).json();
const escaped = payload.html.replace(/"/g, '&quot;');
const fixture = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<iframe id="f" style="width:1150px;height:820px;border:0" srcdoc="${escaped}"></iframe>
</body></html>`;

const server = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(fixture);
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const fixtureOrigin = `http://127.0.0.1:${server.address().port}`;

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const profileDir = resolve(root, '.hyd-profile');
mkdirSync(profileDir, { recursive: true });
const port = 8200 + Math.floor(Math.random() * 200);

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
  await cdp.send('Network.enable');

  await cdp.send('Page.navigate', { url: `${fixtureOrigin}/` });
  await sleep(10000);

  const probe = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const f = document.getElementById('f');
      const w = f.contentWindow;
      const d = f.contentDocument;
      const out = {};
      out.nodes = d.body.querySelectorAll('*').length;
      // React 18/19 mark a hydrated root on the container it took over.
      const rootEl = d.querySelector('#root') || d.body.firstElementChild;
      out.rootId = rootEl ? rootEl.id : null;
      out.rootChildCount = rootEl ? rootEl.children.length : 0;
      // If React hydrated, interactive props exist on the fiber; a cheap proxy is
      // whether any element carries a React internal key.
      let reactKeys = 0;
      for (const el of d.querySelectorAll('*')) {
        for (const k of Object.keys(el)) {
          if (k.startsWith('__reactFiber') || k.startsWith('__reactProps')) { reactKeys += 1; break; }
        }
      }
      out.elementsWithReactProps = reactKeys;
      out.scripts = d.querySelectorAll('script[src]').length;
      out.inlineScripts = [...d.querySelectorAll('script:not([src])')].length;
      // Did Next's runtime survive?
      out.hasNextData = typeof w.__next_f !== 'undefined';
      out.nextFrames = w.__next_f ? w.__next_f.length : 0;
      out.nextRouter = typeof w.next !== 'undefined' || typeof w.__NEXT_DATA__ !== 'undefined';
      return JSON.stringify(out);
    })()`,
    returnByValue: true,
  });
  const state = JSON.parse(probe.result?.result?.value ?? '{}');
  for (const [k, v] of Object.entries(state)) log(`${k}: ${JSON.stringify(v)}`);

  log('--- load failures ---');
  const failed = cdp.events
    .filter((e) => e.method === 'Network.loadingFailed')
    .map((e) => `${e.params.errorText} (${e.params.type})`)
    .slice(0, 10);
  for (const line of failed) log(`  ${line}`);

  log('--- HTTP >= 400 ---');
  const bad = cdp.events
    .filter((e) => e.method === 'Network.responseReceived' && e.params.response.status >= 400)
    .map((e) => `${e.params.response.status} ${String(e.params.response.url).replace(payload.origin, '')}`)
    .slice(0, 10);
  for (const line of bad) log(`  ${line}`);

  log('--- console errors ---');
  const errors = cdp.events
    .filter((e) => e.method === 'Log.entryAdded' && e.params.entry.level === 'error')
    .map((e) => e.params.entry.text.slice(0, 200))
    .slice(0, 10);
  for (const line of errors) log(`  ${line}`);

  log('--- exceptions ---');
  const exceptions = cdp.events
    .filter((e) => e.method === 'Runtime.exceptionThrown')
    .map((e) => (e.params.exceptionDetails?.exception?.description ?? e.params.exceptionDetails?.text ?? '').slice(0, 200))
    .slice(0, 6);
  for (const line of exceptions) log(`  ${line}`);
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
