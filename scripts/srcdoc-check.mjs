/**
 * Try srcdoc: inject the classroom HTML into the frame instead of cross-origin.
 *
 *   node scripts/srcdoc-check.mjs <panelOrigin>
 *
 * A cross-origin iframe may load and compute without ever being painted when the
 * host owns the surface through a WebContentsView. Rendering the same HTML inside
 * a srcdoc frame makes it same-origin, which avoids the cross-origin compositor
 * path entirely. This measures both approaches side by side.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const panelOrigin = process.argv[2];
if (!panelOrigin) {
  console.error('usage: node scripts/srcdoc-check.mjs <panelOrigin>');
  process.exit(2);
}

const log = (m) => console.log(`[srcdoc] ${m}`);
let failures = 0;
const check = (label, ok, detail) => {
  if (ok) log(`PASS ${label}`);
  else {
    failures += 1;
    log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

// Fetch the classroom HTML once and embed it via srcdoc for the second row.
const html = await (await fetch(`${panelOrigin}/`)).text();
log(`fetched ${html.length} bytes of classroom HTML`);
// srcdoc needs attribute-safe quoting; a <base> keeps relative chunk URLs working.
const srcdoc = html
  .replace(/<head>/i, `<head><base href="${panelOrigin}/">`)
  .replace(/"/g, '&quot;');

const fixture = `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box}
  body{margin:0;background:#111;color:#eee;font:12px system-ui}
  .row{height:340px;display:flex;flex-direction:column}
  .row > h3{margin:0;padding:4px 8px;font-size:11px;background:#222;flex:0 0 22px}
  iframe{flex:1 1 auto;min-height:0;width:100%;border:0;display:block;background:#fff}
</style></head><body>
  <div class="row"><h3>cross-origin iframe</h3>
    <iframe id="cross" src="${panelOrigin}/"></iframe></div>
  <div class="row"><h3>srcdoc (same-origin)</h3>
    <iframe id="inline" srcdoc="${srcdoc}"></iframe></div>
  <script>
    window.__loaded = { cross: false, inline: false };
    document.getElementById('cross').addEventListener('load', () => { window.__loaded.cross = true; });
    document.getElementById('inline').addEventListener('load', () => { window.__loaded.inline = true; });
  </script>
</body></html>`;

const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(fixture);
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const fixtureOrigin = `http://127.0.0.1:${server.address().port}`;

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const profileDir = resolve(root, '.srcdoc-check-profile');
mkdirSync(profileDir, { recursive: true });
const port = 9100 + Math.floor(Math.random() * 200);

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
    expression: `JSON.stringify(window.__loaded)`,
    returnByValue: true,
  });
  const loaded = JSON.parse(state.result?.result?.value ?? '{}');
  log(`load events: cross-origin=${loaded.cross} srcdoc=${loaded.inline}`);

  const text = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const pick = (id) => {
        const f = document.getElementById(id);
        try { return (f.contentDocument?.body?.innerText || '').slice(0, 80); }
        catch (e) { return 'cross-origin'; }
      };
      return JSON.stringify({ cross: pick('cross'), inline: pick('inline') });
    })()`,
    returnByValue: true,
  });
  log(`cross-origin text: ${JSON.stringify(text.result?.result?.value)}`);

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const png = Buffer.from(shot.result.data, 'base64');
  const out = resolve(root, '.srcdoc-check.png');
  writeFileSync(out, png);
  log(`screenshot: ${out} (${Math.round(png.length / 1024)} KiB)`);

  check('the cross-origin frame fired load', loaded.cross === true, 'load did not fire');
  check('the srcdoc frame fired load', loaded.inline === true, 'load did not fire');
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

log(failures === 0 ? 'srcdoc strategy compared' : `${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
