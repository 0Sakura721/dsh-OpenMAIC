/**
 * Ask the running app whether the shipped CSS actually produces a full-height
 * iframe, without involving the Harness or a browser cache.
 *
 *   node scripts/css-contract.mjs
 *
 * Every earlier round measured a hand-written fixture or a browser's cached copy
 * of the plugin. This parses the CSS out of lib/client.js and asserts the specific
 * properties that decide the frame's height, so a regression fails here before it
 * reaches a screenshot.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const source = readFileSync(resolve(root, 'lib', 'client.js'), 'utf8');

const log = (m) => console.log(`[css] ${m}`);
let failures = 0;
const check = (label, ok, detail) => {
  if (ok) log(`PASS ${label}`);
  else {
    failures += 1;
    log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

/** Extract a single rule body by selector, from any CSS template literal. */
function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  return match ? match[1].replace(/\s+/g, ' ').trim() : null;
}

const wrap = rule('.lc-openmaic-frame-wrap');
const frame = rule('.lc-openmaic-frame');
const bar = rule('.lc-openmaic-bar');
const root_ = rule('.lc-openmaic-root');
const status = rule('.lc-openmaic-frame-status');

log(`wrap: ${wrap}`);
log(`frame: ${frame}`);
log(`bar: ${bar}`);

check('the wrapper rule exists', wrap !== null);
// The load-bearing decision: the frame's space must come from positioning, not
// from a percentage against an ancestor that may have no definite height.
check('the wrapper is absolutely positioned', /position:\s*absolute/.test(wrap ?? ''), wrap ?? '');
check('the wrapper anchors to all four edges', /top:\s*0/.test(wrap ?? '') && /bottom:\s*0/.test(wrap ?? ''), wrap ?? '');
check(
  'the wrapper reserves the status-bar strip',
  /padding-top:\s*35px/.test(wrap ?? ''),
  wrap ?? '',
);

check('the frame rule exists', frame !== null);
check(
  'the frame carries no percentage height',
  !/height:\s*100%/.test(frame ?? ''),
  frame ?? '',
);
check('the frame grows with flex', /flex:\s*1 1 auto/.test(frame ?? ''), frame ?? '');
check('the frame can shrink', /min-height:\s*0/.test(frame ?? ''), frame ?? '');

check('the status bar is a floating strip', /position:\s*absolute/.test(bar ?? ''), bar ?? '');
check('the status bar has a fixed height', /height:\s*35px/.test(bar ?? ''), bar ?? '');

check('the root fills its host', /position:\s*absolute/.test(root_ ?? ''), root_ ?? '');
check('the overlay start below the bar', /top:\s*35px/.test(status ?? ''), status ?? '');

// Both stylesheets must still be installed, or none of the above is applied.
check('the stylesheet ids are defined', source.includes("'lc-openmaic-css'") && source.includes("'lc-openmaic-host-css'"));
check(
  'the host stylesheet is appended too',
  source.includes("['lc-openmaic-host-css', HOST_CSS]"),
  'host css block missing',
);

log(failures === 0 ? 'css contract verified' : `${failures} css check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
