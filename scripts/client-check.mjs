/**
 * Load the browser half against a fake module loader and client context.
 *
 *   node scripts/client-check.mjs
 *
 * The client bundle is the part that can take the whole Web UI down: a throwing
 * `apply`, or a `register` racing the slot declaration, fails the boot. This runs
 * it the way the shell does — through `window.__ModuleLoader__` with only `react`
 * and `react/jsx-runtime` available — and asserts it registers the card and
 * nothing else.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const log = (m) => console.log(`[client] ${m}`);
let failures = 0;
const check = (label, ok, detail) => {
  if (ok) log(`PASS ${label}`);
  else {
    failures += 1;
    log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

// Minimal React surface: the bundle only touches hooks and the jsx factories at
// module scope. Effects and state are inert here.
const fakeReact = {
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => undefined,
  useMemo: (factory) => factory(),
  createElement: () => ({}),
  Component: class {},
};
const fakeJsx = { jsx: () => ({}), jsxs: () => ({}) };

const requireStub = (id) => {
  if (id === 'react') return fakeReact;
  if (id === 'react/jsx-runtime') return fakeJsx;
  throw new Error(`client bundle required an unexpected module: ${id}`);
};

let loaded;
globalThis.window = {
  __ModuleLoader__: {
    load: (mod) => {
      loaded = mod.factory(requireStub);
    },
  },
  addEventListener: () => {},
  removeEventListener: () => {},
  matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
};

const code = readFileSync(resolve(root, 'lib', 'client.js'), 'utf8');
try {
  new Function('window', code)(globalThis.window);
} catch (error) {
  failures += 1;
  log(`FAIL the bundle threw at load — ${String(error?.message ?? error)}`);
}

check('the bundle registers through the module loader', loaded !== undefined);
if (loaded) {
  check('it exports the expected name', loaded.name === 'dsh-openmaic-client', String(loaded.name));
  check(
    'it declares only the slots service',
    Array.isArray(loaded.inject) && loaded.inject.length === 1 && loaded.inject[0] === 'slots',
    JSON.stringify(loaded.inject),
  );

  const registrations = [];
  let injectedKeys = [];
  const slots = {
    inject: (key, callback) => {
      injectedKeys.push(key);
      const disposer = callback();
      check(`inject(${key}) returned a disposer`, typeof disposer === 'function', typeof disposer);
    },
    register: (options) => {
      registrations.push(`${options.name}[${options.key ?? options.id ?? ''}]`);
      return () => {};
    },
  };

  const ctx = {
    get: (key) => (key === 'slots' ? slots : undefined),
    slots,
  };

  try {
    loaded.apply(ctx);
  } catch (error) {
    failures += 1;
    log(`FAIL apply() threw — ${String(error?.message ?? error)}`);
  }

  log(`injected: ${injectedKeys.join(', ') || '(none)'}`);
  log(`registered: ${registrations.join(', ') || '(none)'}`);

  check(
    'it waits on the toolview slot declaration',
    injectedKeys.includes('tool.call.toolview'),
    injectedKeys.join(','),
  );
  check(
    'it registers exactly one card under openmaic_render',
    registrations.length === 1 && registrations[0] === 'tool.call.toolview[openmaic_render]',
    registrations.join(','),
  );
}

log(failures === 0 ? 'client half verified' : `${failures} client check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
