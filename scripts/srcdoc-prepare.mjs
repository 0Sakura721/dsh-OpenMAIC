/**
 * Rewrite the classroom HTML so it can be embedded same-origin.
 *
 *   node scripts/srcdoc-prepare.mjs <panelOrigin>
 *
 * A cross-origin iframe over a WebContentsView may load without ever being
 * painted. Loading the same HTML through srcdoc makes it same-origin, which
 * sidesteps the cross-origin compositor path — but relative asset URLs then break,
 * because a srcdoc document has no origin of its own.
 *
 * This rewrites the document's relative URLs to absolute ones against the panel
 * origin, and reports whether the result is self-contained enough to embed.
 */

import { writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const panelOrigin = process.argv[2];
if (!panelOrigin) {
  console.error('usage: node scripts/srcdoc-prepare.mjs <panelOrigin>');
  process.exit(2);
}

const log = (m) => console.log(`[prepare] ${m}`);
let failures = 0;
const check = (label, ok, detail) => {
  if (ok) log(`PASS ${label}`);
  else {
    failures += 1;
    log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

const html = await (await fetch(`${panelOrigin}/`)).text();
log(`fetched ${html.length} bytes`);

// Rewrite relative URLs in src/href attributes to absolute ones. This covers the
// <script>/<link> tags Next.js emits; anything left relative is surfaced below.
const rewrites = [
  [/(\s(?:src|href)=["'])\//g, `$1${panelOrigin}/`], // root-absolute
  [/(\s(?:src|href)=["'])(?!https?:|\/\/|data:|#)/g, `$1${panelOrigin}/`], // relative
];

let rewritten = html;
let count = 0;
for (const [pattern, replacement] of rewrites) {
  rewritten = rewritten.replace(pattern, (match, prefix) => {
    if (prefix.includes(panelOrigin)) return match;
    count += 1;
    return replacement;
  });
}

const base = `<base href="${panelOrigin}/">`;
const prepared = rewritten.replace(/<head>/i, `<head>${base}`);

const leftover = [...prepared.matchAll(/(?:src|href)=["'](?!https?:|\/\/|data:|#)/g)].length;
log(`rewrote ${count} URLs`);
check('no relative asset URLs remain', leftover === 0, `${leftover} left`);

// The srcdoc payload must survive being written as an attribute value.
const srcdoc = prepared.replace(/"/g, '&quot;');
log(`srcdoc payload: ${srcdoc.length} bytes`);

const out = resolve(root, '.srcdoc-payload.html');
writeFileSync(out, prepared, 'utf8');
log(`prepared html: ${out}`);

// Sanity: the classroom's own text must still be present after rewriting.
check('the classroom text survived the rewrite', /OpenMAIC|嗨|课堂/.test(prepared));
check('the chunk script tags were made absolute',
  (prepared.match(new RegExp(`${panelOrigin}/_next/`, 'g')) ?? []).length > 5,
  'fewer than 5 rewritten chunk urls');

log(failures === 0 ? 'srcdoc payload prepared' : `${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
