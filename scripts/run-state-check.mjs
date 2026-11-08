/**
 * Mount the panel in a DOM with a running snapshot and an origin.
 *
 *   node scripts/run-state-check.mjs
 *
 * mount-check renders the panel before any snapshot arrives, which exercises only
 * the "not started" branch. The blank panel happens in the running branch, where
 * PanelFrame mounts an iframe — so this stubs fetch to report a running snapshot
 * and asserts the iframe, its wrapper, and the overlay all exist in the DOM.
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const checkout = join(root, 'vendor', 'OpenMAIC');
const requireFromCheckout = createRequire(join(checkout, 'package.json'));
const requireLocal = createRequire(join(root, 'package.json'));

const { JSDOM } = requireLocal('jsdom');
const dom = new JSDOM(
  `<!doctype html><html lang="zh"><body><div id="shell" style="height:600px;width:900px"><div id="centerCol"></div></div></body></html>`,
  { pretendToBeVisual: true, url: 'http://127.0.0.1:63384/' },
);
const { window } = dom;

const realRect = window.Element.prototype.getBoundingClientRect;
window.Element.prototype.getBoundingClientRect = function patched() {
  if (this.id === 'shell') {
    return { top: 0, left: 0, right: 900, bottom: 600, width: 900, height: 600, x: 0, y: 0 };
  }
  return realRect.call(this);
};

globalThis.window = window;
globalThis.document = window.document;
Object.defineProperty(globalThis, 'navigator', {
  value: window.navigator,
  configurable: true,
  writable: true,
});
globalThis.MutationObserver = window.MutationObserver;
globalThis.ResizeObserver = class {
  observe() {}
  disconnect() {}
};
globalThis.HTMLElement = window.HTMLElement;
globalThis.Element = window.Element;
globalThis.Node = window.Node;
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

// The running branch only mounts after a status fetch resolves.
let statusCalls = 0;
globalThis.fetch = async (url) => {
  const target = String(url);
  statusCalls += 1;
  if (target.includes('/status')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        phase: 'running',
        panelOrigin: 'http://127.0.0.1:63441',
        appOrigin: 'http://127.0.0.1:63401',
        pid: 1234,
        dbManaged: true,
        dbVersion: '18.6',
        settings: { allowLocalNetworks: false },
        appliedAllowLocalNetworks: false,
        hasBuild: true,
        appManifest: { name: 'openmaic' },
      }),
    };
  }
  return { ok: true, status: 200, json: async () => ({ ok: true, status: 200 }) };
};

const React = requireFromCheckout('react');
const { createRoot } = requireFromCheckout('react-dom/client');
const jsxRuntime = requireFromCheckout('react/jsx-runtime');

const registry = [];
let loaded;
window.__ModuleLoader__ = {
  load: (mod) => {
    loaded = mod.factory((id) => {
      if (id === 'react') return React;
      if (id === 'react/jsx-runtime') return jsxRuntime;
      throw new Error(`unexpected require: ${id}`);
    });
  },
};
new Function('window', readFileSync(join(root, 'lib', 'client.js'), 'utf8'))(window);
if (!loaded) throw new Error('client bundle did not register');

const api = {
  inject: (_key, cb) => {
    cb();
    return () => {};
  },
  register: (options, component) => {
    registry.push([options.name, component]);
    return () => {};
  },
};
loaded.apply.call(null, Object.assign({ get: (k) => (k === 'slots' ? api : undefined) }, { slots: api }));

const entry = registry.find(([name]) => name === 'main');
if (!entry) throw new Error('main slot not registered');

const container = window.document.getElementById('centerCol');
const reactRoot = createRoot(container);
reactRoot.render(React.createElement(entry[1]));
await new Promise((r) => setTimeout(r, 400));

let failures = 0;
const check = (label, ok, detail) => {
  if (ok) console.log(`PASS ${label}`);
  else {
    failures += 1;
    console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

const statusBar = container.querySelector('.lc-openmaic-bar');
check('the status bar rendered', statusBar !== null);
check('the status fetch ran', statusCalls > 0, `${statusCalls} calls`);
check('the status bar reports running', (statusBar?.textContent ?? '').includes('运行中'),
  statusBar?.textContent ?? '');

const wrap = container.querySelector('.lc-openmaic-frame-wrap');
const frame = container.querySelector('iframe');
const overlay = container.querySelector('.lc-openmaic-frame-status');
check('the frame wrapper mounted', wrap !== null, 'wrapper missing');
check('the iframe mounted', frame !== null, 'iframe missing');
check('the iframe points at the panel origin',
  (frame?.getAttribute('src') ?? '').startsWith('http://127.0.0.1:63441'),
  frame?.getAttribute('src') ?? '');
check('the loading overlay shows until load', overlay !== null);

const rootEl = container.querySelector('.lc-openmaic-root');
console.log('root children:', [...(rootEl?.children ?? [])].map((c) => c.className).join(' | ') || '(none)');

// The regression that cost the most: a stylesheet installed by an older build must
// not survive and shadow the new rules.
const styleNodes = [...window.document.querySelectorAll('style[data-lc-openmaic]')];
console.log('installed styles:', styleNodes.map((n) => n.id).join(' | ') || '(none)');
check('both stylesheets are installed', styleNodes.length === 2, `${styleNodes.length} nodes`);
check(
  'stylesheet ids carry a build marker',
  styleNodes.every((n) => /\-frame-inset-/.test(n.id)),
  styleNodes.map((n) => n.id).join(', '),
);

reactRoot.unmount();
console.log(failures === 0 ? 'running state verified' : `${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
