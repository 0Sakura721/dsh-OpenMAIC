/**
 * Isolate what blocks hydration: the bridge, or the srcdoc container itself?
 *
 *   node scripts/hydration-ab.mjs <harnessOrigin>
 *
 * The frame renders 224 nodes but React never attaches props (`elementsWithReactProps: 0`)
 * and the streamed payload stops at 2 frames. Two candidates:
 *   A. the injected bridge touches `__next_f`, breaking Next's stream bootstrap;
 *   B. `about:srcdoc` itself cannot run this app's hydration path.
 *
 * This runs both variants side by side with identical HTML except for the bridge, so
 * the difference is attributable.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const harness = process.argv[2];
if (!harness) {
  console.error('usage: node scripts/hydration-ab.mjs <harnessOrigin>');
  process.exit(2);
}

const log = (m) => console.log(`[ab] ${m}`);

const payload = await (await fetch(`${harness}/api/dsh-openmaic/embed`)).json();
const withBridge = payload.html;
// Strip the bridge script, keeping the base element and the rebased URLs.
const noBridge = withBridge.replace(/<script>\(function\(\)\{[\s\S]*?__dshOpenmaicBridge[\s\S]*?<\/script>/, '');

log(`with bridge: ${withBridge.length} bytes`);
log(`without bridge: ${noBridge.length} bytes (removed ${withBridge.length - noBridge.length})`);

const makeFrame = (id, html) =>
  `<iframe id="${id}" style="width:560px;height:780px;border:1px solid #333" srcdoc="${html.replace(/"/g, '&quot;')}"></iframe>`;

const fixture = `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;background:#111;color:#eee;font:12px system-ui;display:flex;gap:4px}
  .col{display:flex;flex-direction:column}
  h3{margin:0;padding:2px 6px;background:#222;font-size:11px}
</style></head><body>
  <div class="col"><h3>A: with bridge</h3>${makeFrame('a', withBridge)}</div>
  <div class="col"><h3>B: no bridge</h3>${makeFrame('b', noBridge)}</div>
</body></html>`;

const server = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(fixture);
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const fixtureOrigin = `http://127.0.0.1:${server.address().port}`;
log(`fixture: ${fixtureOrigin}`);

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const profileDir = resolve(root, '.ab-profile');
mkdirSync(profileDir, { recursive: true });
const port = 8100 + Math.floor(Math.random() * 200);

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
  cdp = connect(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');

  await cdp.send('Page.navigate', { url: `${fixtureOrigin}/` });
  await sleep(11000);

  const probe = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const inspect = (id) => {
        const f = document.getElementById(id);
        const w = f.contentWindow;
        const d = f.contentDocument;
        let reactKeys = 0;
        for (const el of d.querySelectorAll('*')) {
          for (const k of Object.keys(el)) {
            if (k.startsWith('__reactFiber') || k.startsWith('__reactProps')) { reactKeys += 1; break; }
          }
        }
        return {
          nodes: d.body.querySelectorAll('*').length,
          reactKeys,
          frames: w.__next_f ? w.__next_f.length : -1,
          bridge: !!(w.__dshOpenmaicBridge && w.__dshOpenmaicBridge.abs),
        };
      };
      return JSON.stringify({ a: inspect('a'), b: inspect('b') });
    })()`,
    returnByValue: true,
  });
  const state = JSON.parse(probe.result?.result?.value ?? '{}');
  log(`A (bridge):    ${JSON.stringify(state.a)}`);
  log(`B (no bridge): ${JSON.stringify(state.b)}`);

  const errors = cdp.events
    .filter((e) => e.method === 'Log.entryAdded' && e.params.entry.level === 'error')
    .map((e) => e.params.entry.text.slice(0, 140))
    .slice(0, 8);
  for (const line of errors) log(`console: ${line}`);

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(resolve(root, '.ab-check.png'), Buffer.from(shot.result.data, 'base64'));
  log('screenshot: .ab-check.png');

  const verdict =
    state.a?.reactKeys === 0 && state.b?.reactKeys > 0
      ? 'the bridge breaks hydration'
      : state.a?.reactKeys > 0
        ? 'hydration works with the bridge'
        : 'srcdoc itself blocks hydration';
  log(`VERDICT: ${verdict}`);
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
