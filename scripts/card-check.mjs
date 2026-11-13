/**
 * Verify the teaching-card contract without a browser.
 *
 *   node scripts/card-check.mjs
 *
 * The card's security model lives in two places: the `sandbox` attribute on the
 * frame and the CSP inside the document. Both are easy to weaken by accident, and
 * a weakened card can reach the Harness page.
 *
 * Comments are stripped before scanning. The first version matched prose that
 * merely *described* the forbidden construct ("without `allow-same-origin`",
 * "touches no `webServer`") and reported three failures against correct code — a
 * check that cannot tell code from its documentation tests nothing.
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

/**
 * Remove comments so a check tests code rather than prose.
 *
 * The first version matched notes that merely *described* a forbidden construct
 * ("without `allow-same-origin`", "touches no `webServer`") and reported three
 * failures against correct code.
 *
 * A hand-written state machine was tried and is not worth the risk: this file's
 * own string literals contain quotes, backticks and `${}`, and getting the lexer
 * subtly wrong makes the check silently vacuous. Comments are removed here by a
 * plain regex list instead, and the one construct that cannot be stripped safely
 * (a template literal) is left alone — so the patterns below are written to never
 * overlap template content.
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments, including JSDoc
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1'); // line comments, but not `https://`
}

const client = stripComments(readFileSync(resolve(root, 'lib/client.js'), 'utf8'));
const host = stripComments(readFileSync(resolve(root, 'lib/index.js'), 'utf8'));
const fragment = stripComments(readFileSync(resolve(root, 'lib/fragment.mjs'), 'utf8'));

// --- isolation -----------------------------------------------------------------
// `allow-same-origin` beside `allow-scripts` defeats the sandbox entirely: the
// frame would share the Harness origin and could read its storage.
check(
  'the frame is sandboxed with allow-scripts only',
  /sandbox:\s*'allow-scripts'/.test(client),
  'sandbox attribute not found',
);
check(
  'allow-same-origin is never granted in code',
  !/allow-same-origin/.test(client),
  'allow-same-origin present in executable code',
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
// A bare register racing the slot declaration fails boot; `slots.inject` waits.
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
// The Host registering a web route is what let a bad proxy wedge the whole UI.
check(
  'the Host never claims a web route',
  !/webServer/.test(host),
  'the Host touches webServer',
);
check(
  'the Host registers exactly one tool',
  (host.match(/tools\.register\(/g) ?? []).length === 1,
  'unexpected number of tool registrations',
);
check(
  'the Host declares no network or database dependency',
  !/node:http|node:https|node:net|from 'pg'|require\('pg'\)/.test(host) && !/\bfetch\s*\(/.test(host),
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

// The stripper itself must work, or the checks above pass vacuously. The trick
// is the two-sided guarantee: a block comment disappears, and a URL's `//` does
// not (its colon protects it).
check(
  'the comment stripper removes block comments',
  stripComments('/* note */ const a = 1;') === ' const a = 1;',
  JSON.stringify(stripComments('/* note */ const a = 1;')),
);
check(
  'the comment stripper leaves a URL intact',
  stripComments("const u = 'https://example.com/x';").includes('https://example.com/x'),
  stripComments("const u = 'https://example.com/x';"),
);

log(failures === 0 ? 'card contract verified' : `${failures} card check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
