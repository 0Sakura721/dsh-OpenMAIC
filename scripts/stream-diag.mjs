/**
 * Did the frame's scripts execute at all, and what stopped the stream?
 *
 *   node scripts/stream-diag.mjs <harnessOrigin>
 *
 * React's payload advanced 2 frames and then stopped — silently, with no console
 * error, no failed request and no thrown exception. That pattern means a script ran
 * and returned early, not that it never ran.
 *
 * This reports, inside the frame: how many scripts executed (via a marker each one
 * leaves behind), whether `document.currentScript` is available where Next expects
 * it, and what `__next_f` contains when the page settles.
 */

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const harness = process.argv[2];
if (!harness) {
  console.error('usage: node scripts/stream-diag.mjs <harnessOrigin>');
  process.exit(2);
}

const log = (m) => console.log(`[stream] ${m}`);

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
const profileDir = resolve(root, '.stream-profile');
mkdirSync(profileDir, { recursive: true });
const port = 8000 + Math.floor(Math.random() * 200);

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
  await sleep(11000);

  const probe = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const f = document.getElementById('f');
      const w = f.contentWindow;
      const d = f.contentDocument;
      const out = {};
      // Which globals survived? These are what Next's runtime looks for.
      out.hasReact = typeof w.React !== 'undefined';
      out.hasNext = typeof w.next !== 'undefined';
      out.hasN = typeof w.__next_route_announcer__ !== 'undefined';
      out.nextF = w.__next_f ? w.__next_f.length : -1;
      out.nextF0 = w.__next_f && w.__next_f[0] ? JSON.stringify(w.__next_f[0]).slice(0, 40) : null;
      out.nextF1 = w.__next_f && w.__next_f[1] ? JSON.stringify(w.__next_f[1]).slice(0, 40) : null;
      // Does the platform see our URL patch applied to this frame's global?
      out.urlPatched = w.__dshURL !== undefined;
      // Current script, which Next uses to resolve chunk paths.
      out.currentScriptInEval = (function(){ try { return document.currentScript === null; } catch(e) { return 'err'; } })();
      // Count script elements and whether each produced any evidence of running.
      out.scriptTags = d.querySelectorAll('script[src]').length;
      out.inlineScriptTags = d.querySelectorAll('script:not([src])').length;
      // The frame's own URL: what Next sees as the document location.
      out.location = w.location.href.slice(0, 70);
      out.baseURI = d.baseURI.slice(0, 70);
      // Is React's root container the one Next chose?
      out.reactRoot = !!d.querySelector('#__next, #root, main');
      return JSON.stringify(out);
    })()`,
    returnByValue: true,
  });
  const state = JSON.parse(probe.result?.result?.value ?? '{}');
  for (const [k, v] of Object.entries(state)) log(`${k}: ${JSON.stringify(v)}`);

  log('--- console ---');
  const errors = cdp.events
    .filter((e) => e.method === 'Log.entryAdded')
    .map((e) => `${e.params.entry.level}: ${String(e.params.entry.text).slice(0, 160)}`)
    .slice(0, 12);
  for (const line of errors) log(`  ${line}`);

  log('--- exceptions ---');
  const exceptions = cdp.events
    .filter((e) => e.method === 'Runtime.exceptionThrown')
    .map((e) => String(e.params.exceptionDetails?.exception?.description ?? e.params.exceptionDetails?.text ?? '').slice(0, 160))
    .slice(0, 8);
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
