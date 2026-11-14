/**
 * Load the proxied classroom in a real browser and report what it renders.
 *
 *   node scripts/page-render-check.mjs <panelOrigin>
 *
 * Static checks proved the HTML, JS chunks and CSS all arrive with 200. That still
 * leaves "renders blank" possible — client-side hydration is what paints this app,
 * so this drives Edge at the proxied origin directly and reads back the DOM depth,
 * visible text and any console errors.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const panelOrigin = process.argv[2];
if (!panelOrigin) {
  console.error('usage: node scripts/page-render-check.mjs <panelOrigin>');
  process.exit(2);
}

const log = (m) => console.log(`[render] ${m}`);
let failures = 0;
const check = (label, ok, detail) => {
  if (ok) log(`PASS ${label}`);
  else {
    failures += 1;
    log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const profileDir = resolve(root, '.render-check-profile');
mkdirSync(profileDir, { recursive: true });
const port = 9600 + Math.floor(Math.random() * 200);

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

  const failedRequests = [];
  cdp.events; // populated by the handlers below
  const collector = (event) => {
    if (event.method === 'Network.loadingFailed') {
      failedRequests.push(`${event.params.errorText} (type ${event.params.type})`);
    } else if (event.method === 'Network.responseReceived' && event.params.response.status >= 400) {
      failedRequests.push(
        `${event.params.response.status} ${event.params.response.url.replace(panelOrigin, '')}`,
      );
    }
  };
  const rawSocket = cdp;
  rawSocket.events.push; // keep reference alive
  // The connect() helper stores events; the collector is attached to the same list.
  const patched = cdp.events;
  cdp.events = patched;
  const interval = setInterval(() => {}, 1000);
  clearInterval(interval);

  await cdp.send('Page.navigate', { url: `${panelOrigin}/` });
  await sleep(8000);

  // Drain everything the page did on the network, so a failing asset is named
  // instead of only being counted as "a 500 happened".
  const recent = cdp.events
    .filter((e) => e.method === 'Network.responseReceived' || e.method === 'Network.loadingFailed')
    .map((e) =>
      e.method === 'Network.loadingFailed'
        ? `failed: ${e.params.errorText}`
        : `${e.params.response.status} ${e.params.response.url.replace(panelOrigin, '')}`,
    )
    .filter((line) => /^[45]\d\d|^failed:/.test(line))
    .slice(0, 12);
  for (const line of recent) log(`net: ${line}`);

  const result = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const root = document.body;
      const text = (root?.innerText || '').replace(/\s+/g, ' ').trim();
      const visible = [...document.querySelectorAll('*')].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 2 && r.height > 2;
      }).length;
      const homePage = document.querySelector('[data-testid="home-page"]');
      return JSON.stringify({
        title: document.title,
        nodes: document.querySelectorAll('*').length,
        visible,
        text: text.slice(0, 120),
        hasHomePage: homePage !== null,
        bodyChildren: root ? root.children.length : 0,
        stylesheets: [...document.styleSheets].length,
      });
    })()`,
    returnByValue: true,
  });
  const state = JSON.parse(result.result?.result?.value ?? '{}');
  log(`title: ${state.title}`);
  log(`nodes: ${state.nodes}, visible boxes: ${state.visible}, stylesheets: ${state.stylesheets}`);
  log(`has home-page marker: ${state.hasHomePage}, body children: ${state.bodyChildren}`);
  log(`text: ${JSON.stringify(state.text)}`);

  const errors = cdp.events
    .filter((e) => e.method === 'Log.entryAdded' && e.params.entry.level === 'error')
    .map((e) => e.params.entry.text)
    .slice(0, 10);
  for (const line of errors) log(`console: ${line}`);

  check('the page produced DOM', (state.nodes ?? 0) > 50, `${state.nodes} nodes`);
  check('the page has visible boxes', (state.visible ?? 0) > 30, `${state.visible} visible`);
  check('the home page shell rendered', state.hasHomePage === true);
  check('the classroom rendered its text', /OpenMAIC|嗨|课堂|同学/.test(state.text ?? ''), state.text ?? '');
  check('no fatal console error', !errors.some((line) => /Uncaught|SyntaxError|TypeError|ReferenceError/.test(line)),
    errors.join(' | ').slice(0, 200));

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const png = Buffer.from(shot.result.data, 'base64');
  const out = resolve(root, '.render-check.png');
  writeFileSync(out, png);
  log(`screenshot: ${out} (${Math.round(png.length / 1024)} KiB)`);
} catch (error) {
  failures += 1;
  log(`FAIL ${String(error?.stack ?? error).split('\n').slice(0, 4).join(' ')}`);
} finally {
  cdp?.close();
  try {
    browser.kill('SIGKILL');
  } catch {}
}

log(failures === 0 ? 'page render verified' : `${failures} render check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
