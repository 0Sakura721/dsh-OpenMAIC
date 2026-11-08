/**
 * Frame the panel inside a faithful copy of the shell's layout.
 *
 *   node scripts/frame-check.mjs <panelOrigin> [--png out.png]
 *
 * This is the regression test for the blank panel. The failure was pure geometry,
 * so a test must reproduce the geometry: a grid centre column, `.mainPanel` with
 * `padding-top`, and a slot seat with no height of its own. Inside that box it
 * asserts the plugin's host, fill, and iframe all resolve real heights and that the
 * framed document actually painted pixels.
 *
 * It also proves the fix rather than the symptom: the fill is anchored with
 * `inset:0`, so it fills the host even when the measurement effect never runs.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const panelOrigin = args[0];
const pngIndex = args.indexOf('--png');
const pngOut = pngIndex >= 0 ? args[pngIndex + 1] : resolve(root, '.frame-check.png');
if (!panelOrigin) {
  console.error('usage: node scripts/frame-check.mjs <panelOrigin> [--png out.png]');
  process.exit(2);
}

const log = (m) => console.log(`[frame] ${m}`);
let failures = 0;
const check = (label, ok, detail) => {
  if (ok) log(`PASS ${label}`);
  else {
    failures += 1;
    log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

// Mirrors dsh-client-ui-layout: `.centerCol` is a grid item with overflow:hidden,
// `.mainPanel` is a flex column with flex:1/min-height:0, and a global panel adds
// `padding-top`. The seat adds no height of its own — that is the trap.
const fixture = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><style>
  *{box-sizing:border-box}
  html,body{margin:0;height:100%;font:13px system-ui;background:#1b1d21;color:#e6e6e6}
  .frame{display:grid;grid-template-columns:220px 1fr;height:100%}
  .side{background:#141619;padding:12px}
  .centerCol{grid-area:1/2;display:flex;flex-direction:column;min-width:0;overflow:hidden;background:#0f1115}
  .mainPanel{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0}
  .mainPanel[data-global-panel]{padding-top:max(0px, calc(48px - 0px))}
  .slotSeat{display:contents}
</style></head><body>
  <div class="frame">
    <div class="side">sidebar</div>
    <div class="centerCol"><div class="mainPanel" data-global-panel><div class="slotSeat" id="seat"></div></div></div>
  </div>
  <script>
    // Exactly the plugin's structure; the fill relies on inset, never on JS.
    const seat = document.getElementById('seat');
    const host = document.createElement('div');
    host.className = 'lc-openmaic-host';
    host.style.cssText = 'position:relative;display:block;flex:1 1 auto;min-width:0;min-height:0;width:100%;height:100%;overflow:hidden';
    const fill = document.createElement('div');
    fill.className = 'lc-openmaic-fill';
    fill.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;width:100%;height:100%;min-height:0';
    const rootEl = document.createElement('div');
    rootEl.className = 'lc-openmaic-root';
    rootEl.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;width:100%;height:100%;overflow:hidden';    const bar = document.createElement('div');
    bar.className = 'lc-openmaic-bar';
    bar.style.cssText = 'display:flex;align-items:center;min-height:32px;padding:4px 10px;border-bottom:1px solid #333;flex:0 0 auto';
    bar.textContent = 'OpenMAIC 课堂 · 运行中';
    const frame = document.createElement('iframe');
    frame.className = 'lc-openmaic-frame';
    // The shipped rule, including the explicit height that beats an iframe's
    // 150px default inside a flex column with no resolved height.
    frame.style.cssText = 'flex:1 1 auto;min-height:0;width:100%;height:100%;border:0;display:block;background:#fff';
    frame.src = ${JSON.stringify(`${panelOrigin}/`)};
    const wrap = document.createElement('div');
    wrap.className = 'lc-openmaic-frame-wrap';
    wrap.style.cssText = 'position:relative;flex:1 1 auto;min-height:0;min-width:0;width:100%;height:100%;display:flex;flex-direction:column;overflow:hidden';
    const status = document.createElement('div');
    status.className = 'lc-openmaic-frame-status';
    status.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(20,22,26,.96);color:#fff';
    status.textContent = '正在加载课堂界面…';
    frame.addEventListener('load', () => { status.remove(); window.__frameLoaded = true; });
    wrap.append(frame, status);
    rootEl.append(bar, wrap);
    fill.append(rootEl);
    host.append(fill);
    seat.append(host);
  </script>
</body></html>`;

const server = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(fixture);
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const fixtureOrigin = `http://127.0.0.1:${server.address().port}`;

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const profileDir = resolve(root, '.frame-check-profile');
mkdirSync(profileDir, { recursive: true });
const port = 9700 + Math.floor(Math.random() * 200);

const browser = spawn(
  EDGE,
  [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--window-size=1280,860',
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
  await sleep(6500);

  const measured = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const pick = (sel) => { const el = document.querySelector(sel); if (!el) return null;
        const r = el.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height) }; };
      return {
        centerCol: pick('.centerCol'), mainPanel: pick('.mainPanel'),
        host: pick('.lc-openmaic-host'), fill: pick('.lc-openmaic-fill'),
        root: pick('.lc-openmaic-root'),
        bar: pick('.lc-openmaic-bar'), frame: pick('iframe.lc-openmaic-frame'),
        overlayPresent: document.querySelector('.lc-openmaic-frame-status') !== null,
        frameLoaded: window.__frameLoaded === true,
      };
    })()`,
    returnByValue: true,
  });
  const geo = measured.result?.result?.value ?? {};
  for (const [key, value] of Object.entries(geo)) log(`${key}: ${JSON.stringify(value)}`);

  check('the shell gives the centre column a height', (geo.centerCol?.h ?? 0) > 300, JSON.stringify(geo.centerCol));
  check('the plugin host receives a real height', (geo.host?.h ?? 0) > 300, JSON.stringify(geo.host));
  check('the fill matches the host (inset anchor)',
    Math.abs((geo.fill?.h ?? 0) - (geo.host?.h ?? 0)) <= 1, `fill ${geo.fill?.h} vs host ${geo.host?.h}`);
  check('the status bar keeps its own height', (geo.bar?.h ?? 0) >= 24, JSON.stringify(geo.bar));
  check('the iframe fills the remaining area', (geo.frame?.h ?? 0) > 300, JSON.stringify(geo.frame));
  check(
    'the iframe fills the space under the status bar',
    Math.abs((geo.frame?.h ?? 0) - ((geo.root?.h ?? 0) - (geo.bar?.h ?? 0))) <= 2,
    `frame ${geo.frame?.h} vs root-bar ${(geo.root?.h ?? 0) - (geo.bar?.h ?? 0)}`,
  );
  check('the iframe fired its load event', geo.frameLoaded === true, 'load never fired');
  check('the loading overlay clears once loaded', geo.overlayPresent === false, 'overlay still covering the frame');

  // Pixels, not just boxes: a white iframe means navigation failed silently.
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const png = Buffer.from(shot.result.data, 'base64');
  writeFileSync(pngOut, png);
  log(`screenshot: ${pngOut} (${Math.round(png.length / 1024)} KiB)`);
  check('the framed page painted something', png.length > 20000, `${png.length} bytes`);
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

log(failures === 0 ? 'panel framing verified' : `${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
