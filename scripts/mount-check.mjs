/**
 * Mount the real panel in a DOM and assert it occupies space.
 *
 *   node scripts/mount-check.mjs
 *
 * A server render cannot catch this class of bug: `useEffect` never runs, so the
 * measurement path is dead code and the markup looks fine. This mounts the
 * component the way the shell does — into a zero-height, overflow-hidden column
 * with a real-sized ancestor — and asserts the panel ends up with a usable height.
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const checkout = join(root, 'vendor', 'OpenMAIC');
const requireFromCheckout = createRequire(join(checkout, 'package.json'));
const requireLocal = createRequire(join(root, 'package.json'));

// React must be the one the client bundle asks for; jsdom is a dev dependency of
// this repository, not of the checkout.
const { JSDOM } = requireLocal('jsdom');

const dom = new JSDOM(
  `<!doctype html><html lang="zh"><body>
     <div id="shell" style="height:600px;width:900px">
       <div id="centerCol" style="overflow:hidden"></div>
     </div>
   </body></html>`,
  { pretendToBeVisual: true, url: 'http://127.0.0.1:54417/' },
);
const { window } = dom;

// jsdom reports 0 for layout, so give the two boxes the sizes the browser would.
const realRect = window.Element.prototype.getBoundingClientRect;
window.Element.prototype.getBoundingClientRect = function patched() {
  if (this.id === 'shell') {
    return { top: 0, left: 0, right: 900, bottom: 600, width: 900, height: 600, x: 0, y: 0 };
  }
  if (this.id === 'centerCol') {
    // The bug: the slot container itself has no height.
    return { top: 0, left: 0, right: 900, bottom: 0, width: 900, height: 0, x: 0, y: 0 };
  }
  return realRect.call(this);
};

globalThis.window = window;
globalThis.document = window.document;
// `navigator` is a getter-only global in modern Node; define it instead.
Object.defineProperty(globalThis, 'navigator', {
  value: window.navigator,
  configurable: true,
  writable: true,
});
globalThis.MutationObserver = window.MutationObserver;
globalThis.ResizeObserver = class {
  observe() {}
  disconnect() {}
  unobserve() {}
};
globalThis.HTMLElement = window.HTMLElement;
globalThis.Element = window.Element;
globalThis.Node = window.Node;
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.IS_REACT_ACT_ENVIRONMENT = false;

const React = requireFromCheckout('react');
const { createRoot } = requireFromCheckout('react-dom/client');
const jsxRuntime = requireFromCheckout('react/jsx-runtime');

const registry = [];
let loaded;
globalThis.window.__ModuleLoader__ = {
  load: (mod) => {
    loaded = mod.factory((id) => {
      if (id === 'react') return React;
      if (id === 'react/jsx-runtime') return jsxRuntime;
      throw new Error(`unexpected require: ${id}`);
    });
  },
};

const code = readFileSync(join(root, 'lib', 'client.js'), 'utf8');
new Function('window', code)(globalThis.window);
if (!loaded) throw new Error('client bundle did not register through the module loader');

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
loaded.apply.call(
  null,
  Object.assign(
    { get: (key) => (key === 'slots' ? api : undefined) },
    // Cordis exposes services as getters on the caller's context; the fixture
    // must too, because the bundle reads both `ctx.get(...)` and `ctx.slots`.
    { slots: api },
  ),
);

const entry = registry.find(([name]) => name === 'main');
if (!entry) throw new Error('the main slot was not registered');

const container = window.document.getElementById('centerCol');
const reactRoot = createRoot(container);
reactRoot.render(React.createElement(entry[1]));

await new Promise((r) => setTimeout(r, 300));

const host = container.querySelector('.lc-openmaic-host');
const fill = container.querySelector('.lc-openmaic-fill');
const bar = container.querySelector('.lc-openmaic-bar');

console.log(`host present: ${host !== null}`);
console.log(`fill present: ${fill !== null}`);
console.log(`status bar present: ${bar !== null}`);
console.log(`inline height: ${fill?.style?.height || '(none)'}`);

const match = /^(\d+(?:\.\d+)?)px$/.exec(fill?.style?.height ?? '');
const height = match ? Number(match[1]) : 0;

let failures = 0;
const check = (label, ok, detail) => {
  if (ok) console.log(`PASS ${label}`);
  else {
    failures += 1;
    console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

check('the panel paints a status bar', bar !== null);
check(
  'the panel resolves a usable height inside a zero-height slot',
  height >= 320,
  `resolved ${height}px`,
);
check('the panel tracks the real ancestor height', height === 600, `resolved ${height}px, expected 600`);

reactRoot.unmount();
console.log(failures === 0 ? 'mount verified' : `${failures} mount check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
