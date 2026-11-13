/**
 * Verify the teaching-card contract without a browser.
 *
 *   node scripts/card-check.mjs
 *
 * The card's security model is entirely in two places: the `sandbox` attribute on
 * the frame and the CSP inside the document. Both are easy to weaken by accident,
 * and a weakened card can reach the Harness page. This parses the shipped client
 * bundle and asserts the properties that make the card safe and functional.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const log = (m) => console.log(`[card] ${m}`);
let failures = 0;
const check = (label, ok, detail) => {
  if (ok) log(`PASS ${label}`);
  else {
    failures += 1;
    log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

const client = readFileSync(resolve(root, 'lib', 'client.js'), 'utf8');
const host = readFileSync(resolve(root, 'lib', 'index.js'), 'utf8');
const fragment = readFileSync(resolve(root, 'lib', 'fragment.mjs'), 'utf8');

// --- isolation -----------------------------------------------------------------
// `allow-same-origin` together with `allow-scripts` defeats the sandbox entirely:
// the frame would share the Harness origin and could read its storage. It must
// never appear.
check(
  'the frame is sandboxed with allow-scripts only',
  /sandbox:\s*'allow-scripts'/.test(client),
  'sandbox attribute not found',
);
check(
  'allow-same-origin is never granted',
  !/allow-same-origin/.test(client),
  'allow-same-origin present — the sandbox would be escapable',
);
check(
  'the frame CSP blocks network egress',
  /connect-src blob: data:/.test(client) && !/connect-src[^"']*https:/.test(client),
  'connect-src too permissive',
);
check(
  'the frame CSP forbids nested frames and objects',
  /frame-src 'none'/.test(client) && /object-src 'none'/.test(client),
);
check(
  'the frame CSP forbids form posts and base rewriting',
  /form-action 'none'/.test(client) && /base-uri 'none'/.test(client),
);

// --- wiring ---------------------------------------------------------------------
// A direct register racing the slot declaration is what took the Web UI down. The
// inject wrapper is required, not stylistic.
check(
  'the card registers through slots.inject',
  /ctx\.slots\.inject\('tool\.call\.toolview'/.test(client),
  'register does not wait for the slot declaration',
);
check(
  'the card registers under the tool wire name',
  /key:\s*TOOL_NAME/.test(client) && /const TOOL_NAME = 'openmaic_render'/.test(client),
);

// --- host side ------------------------------------------------------------------
check(
  'the Host never claims a web route',
  !/webServer/.test(host),
  'the Host touches webServer — this is what wedged the UI before',
);
check(
  'the Host registers exactly one tool',
  (host.match(/tools\.register\(/g) ?? []).length === 1,
  'unexpected number of tool registrations',
);
check(
  'the Host declares no network or database dependency',
  !/node:http|node:net|pg|fetch\(/.test(host),
  'the Host gained a network dependency',
);

// --- fragment validation ---------------------------------------------------------
check('the validator rejects document scaffolding', /DOCUMENT_MARKERS/.test(fragment));
check('the validator enforces a size ceiling', /MAX_FRAGMENT_BYTES/.test(fragment));

// --- height bridge ---------------------------------------------------------------
check(
  'the card reports its height to the host',
  /dsh-openmaic:height/.test(client) && /parent\.postMessage/.test(client),
);

log(failures === 0 ? 'card contract verified' : `${failures} card check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
