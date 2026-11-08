/**
 * Render the browser half with a real React, server-side.
 *
 * A white panel means the component threw (or returned nothing) while the
 * sidebar icon still rendered, which points at the render path rather than at
 * registration. Rendering it here surfaces the actual error and proves each
 * branch produces markup.
 *
 *   node scripts/render-check.mjs
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const reactDir = join(root, 'vendor', 'OpenMAIC', 'node_modules');
const requireFromApp = createRequire(join(reactDir, '..', 'package.json'));

const React = requireFromApp('react');
const { renderToStaticMarkup } = requireFromApp('react-dom/server');
const jsxRuntime = requireFromApp('react/jsx-runtime');

const registry = [];
const fakeRequire = (id) => {
  if (id === 'react') return React;
  if (id === 'react/jsx-runtime') return jsxRuntime;
  throw new Error(`client bundle required an unexpected module: ${id}`);
};

let loaded;
globalThis.window = {
  __ModuleLoader__: {
    load: (mod) => {
      loaded = mod.factory(fakeRequire);
    },
  },
};
// The bundle touches these only inside effects, which a server render never runs.
globalThis.document = {
  documentElement: { lang: 'zh', getAttribute: () => 'zh', setAttribute() {} },
  getElementById: () => null,
  createElement: () => ({ setAttribute() {}, style: {}, appendChild() {}, remove() {} }),
  head: { appendChild() {} },
};
globalThis.MutationObserver = class {
  observe() {}
  disconnect() {}
};

const code = readFileSync(join(root, 'lib', 'client.js'), 'utf8');
new Function('window', code)(globalThis.window);

if (!loaded || typeof loaded.apply !== 'function') throw new Error('client bundle did not export apply');
console.log(`client name: ${loaded.name}`);

const ctx = {
  get: (key) => (key === 'slots' ? ctx.slots : undefined),
  slots: {
    inject: (_key, cb) => {
      cb();
      return () => {};
    },
    register: (options, component) => {
      registry.push([options.name, options, component]);
      return () => {};
    },
  },
};

loaded.apply(ctx);
console.log(`registered: ${registry.map(([n, o]) => `${n}${o.key ? `[${o.key}]` : ''}`).join(', ')}`);

let failures = 0;
for (const [slot, options, Component] of registry) {
  if (slot === 'sidebar.panellist') {
    const html = renderToStaticMarkup(React.createElement(Component, { size: 16 }));
    const ok = html.includes('<svg') && html.includes('viewBox');
    console.log(`${ok ? 'PASS' : 'FAIL'} ${slot} renders an icon (${html.length} bytes)`);
    if (!ok) failures += 1;
    continue;
  }
  try {
    // No fetch in a server render: the hook starts from its empty snapshot, which
    // is exactly the "not started yet" branch a user sees before the first poll.
    const html = renderToStaticMarkup(React.createElement(Component, {}));
    const ok = html.length > 40;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${slot} renders (${html.length} bytes)`);
    if (!ok) failures += 1;
    if (slot === 'main') console.log(`  main markup: ${html.slice(0, 220)}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL ${slot} threw: ${String(error?.stack ?? error).split('\n').slice(0, 6).join('\n')}`);
  }
}

console.log(failures === 0 ? 'render verified' : `${failures} render check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
