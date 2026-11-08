/**
 * Prove the prepared srcdoc payload actually renders the classroom.
 *
 *   node scripts/srcdoc-render-check.mjs <panelOrigin>
 *
 * The previous comparison fetched the raw HTML and noticed the assets broke,
 * because a srcdoc document has no origin to resolve relative URLs against. This
 * runs the same prepare step the plugin will use — rewrite URLs to absolute — and
 * then asserts the classroom renders inside the embedded frame.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const panelOrigin = process.argv[2];
if (!panelOrigin) {
  console.error('usage: node scripts/srcdoc-render-check.mjs <panelOrigin>');
  process.exit(2);
}

const log = (m) => console.log(`[srcdoc-render] ${m}`);
let failures = 0;
const check = (label, ok, detail) => {
  if (ok) log(`PASS ${label}`);
  else {
    failures += 1;
    log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

// Same preparation the plugin performs: rewrite every relative asset URL to an
// absolute one and add a base so dynamic imports also resolve.
const raw = await (await fetch(`${panelOrigin}/`)).text();
let prepared = raw;
prepared = prepared.replace(/(\s(?:src|href)=["'])\//g, `$1${panelOrigin}/`);
prepared = prepared.replace(
  /(\s(?:src|href)=["'])(?!https?:|\/\/|data:|#)/g,
  `$1${panelOrigin}/`,
);
prepared = prepared.replace(/<head>/i, `<head><base href="${panelOrigin}/">`);
const srcdoc = prepared.replace(/"/g, '&quot;');
log(`prepared ${srcdoc.length} bytes`);

const fixture = `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box}
  body{margin:0;background:#111;color:#eee;font:12px system-ui}
  .row{height:600px;display:flex;flex-direction:column}
  .row > h3{margin:0;padding:4px 8px;font-size:11px;background:#222;flex:0 0 22px}
  iframe{flex:1 1 auto;min-height:0;width:100%;border:0;display:block;background:#fff}
</style></head><body>
  <div class="row"><h3>prepared srcdoc</h3><iframe id="frame" srcdoc="${srcdoc}"></iframe></div>
  <script>
    window.__loaded = false;
    document.getElementById('frame').addEventListener('load', () => { window.__loaded = true; });
  </script>
</body></html>`;

const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(fixture);
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const fixtureOrigin = `http://127.0.0.1:${server.address().port}`;

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const profileDir = resolve(root, '.srcdoc-render-profile');
mkdirSync(profileDir, { recursive: true });
const port = 9400 + Math.floor(Math.random() * 200);

const browser = spawn(
  EDGE,
  [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--window-size=1100,760',
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

  const state = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const f = document.getElementById('frame');
      let text = '', nodes = 0, styles = 0;
      try {
        const d = f.contentDocument;
        nodes = d ? d.querySelectorAll('*').length : 0;
        styles = d ? d.styleSheets.length : 0;
        text = d && d.body ? d.body.innerText.replace(/\\s+/g,' ').slice(0, 120) : '';
      } catch (e) { text = 'blocked: ' + e.message; }
      return JSON.stringify({ loaded: window.__loaded, nodes, styles, text });
    })()`,
    returnByValue: true,
  });
  const s = JSON.parse(state.result?.result?.value ?? '{}');
  log(`loaded=${s.loaded} nodes=${s.nodes} styles=${s.styles}`);
  log(`text: ${JSON.stringify(s.text)}`);

  check('the srcdoc frame fired load', s.loaded === true, 'load did not fire');
  check('the classroom produced DOM', (s.nodes ?? 0) > 40, `${s.nodes} nodes`);
  check('its stylesheets loaded', (s.styles ?? 0) > 0, `${s.styles} stylesheets`);
  check('the classroom rendered its text', /OpenMAIC|嗨|课堂|同学/.test(s.text ?? ''), s.text ?? '');

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const png = Buffer.from(shot.result.data, 'base64');
  const out = resolve(root, '.srcdoc-render.png');
  writeFileSync(out, png);
  log(`screenshot: ${out} (${Math.round(png.length / 1024)} KiB)`);
  check('the frame painted pixels', png.length > 20000, `${png.length} bytes`);
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

log(failures === 0 ? 'srcdoc render verified' : `${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
