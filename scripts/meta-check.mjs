/**
 * End-to-end check of the meta channel: Host projection → browser card.
 *
 *   node scripts/meta-check.mjs
 *
 * The card was blank for a whole session because the Host never produced a meta
 * descriptor and the browser half looked for it in the wrong place. Neither half
 * can catch that alone: the Host succeeds, the card renders, and the frame is
 * simply empty.
 *
 * This runs both halves against each other — the real `presentationMeta` output
 * is fed into the real `readCard` — so a break in either side fails here.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const log = (m) => console.log(`[meta] ${m}`);
let failures = 0;
const check = (label, ok, detail) => {
  if (ok) log(`PASS ${label}`);
  else {
    failures += 1;
    log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

// --- host half: capture the tool definition the plugin registers ---------------
const registered = [];
const ctx = {
  get: (name) => {
    if (name === 'tools') {
      return {
        register: (definition) => {
          registered.push(definition);
          return () => {};
        },
      };
    }
    if (name === 'systemPrompt') {
      return { section: () => () => {} };
    }
    return undefined;
  },
  effect: (factory) => factory(),
};

const host = await import(pathToFileURL(resolve(root, 'lib/index.js')).href);
host.apply(ctx, {});

check('the Host registers one tool', registered.length === 1, `${registered.length} registered`);
const tool = registered[0];
check('the tool is openmaic_render', tool?.name === 'openmaic_render', String(tool?.name));
check(
  'the tool defines presentationMeta',
  typeof tool?.output?.presentationMeta === 'function',
  'missing — the card would have no payload',
);

// --- the Host's own execution path --------------------------------------------
const fragment = '<div class="x">地理卡片</div><script>1<\/script>';
let value;
try {
  value = await tool.execute({ fragment, title: '测试卡片' });
} catch (error) {
  check('the tool accepts a valid fragment', false, String(error?.message ?? error));
}
check('the tool returns a value', value !== undefined);
check('the value keeps the fragment', value?.fragment === fragment);

const meta = tool.output.presentationMeta({}, value);
log(`meta: ${JSON.stringify({ ...meta, fragment: `${String(meta?.fragment).slice(0, 24)}…` })}`);

check('the meta is a plain object', meta !== null && typeof meta === 'object');
check('the meta carries the fragment', meta?.fragment === fragment, 'fragment lost in projection');
check('the meta carries the title', meta?.title === '测试卡片', String(meta?.title));
check('the meta is JSON-serialisable', (() => {
  try {
    return JSON.stringify(JSON.parse(JSON.stringify(meta))) === JSON.stringify(meta);
  } catch {
    return false;
  }
})());

// --- browser half: run readCard against that exact meta -----------------------
const code = readFileSync(resolve(root, 'lib/client.js'), 'utf8');
// `readCard` is module-private; lift it out by evaluating the bundle in a stub
// loader and re-declaring the same narrowing the card uses. Keeping the real
// source in play is the point: a change to the shape breaks this file too.
const body = code.slice(code.indexOf('function readCard'));
const readCardSource = body.slice(0, body.indexOf('\n\t\t}') + 4);

const readCard = new Function(`${readCardSource}; return readCard;`)();

const fromMeta = readCard({ phase: 'result', block: { meta } });
check('the card reads the payload from block.meta', fromMeta !== null, 'readCard returned null');
check('the card receives the fragment', fromMeta?.fragment === fragment, 'fragment did not survive');
check('the card receives the title', fromMeta?.title === '测试卡片', String(fromMeta?.title));

// Unknown shapes must not throw; they should report nothing and let the card say
// "preparing" rather than crash the conversation row.
check('an empty props object yields null', readCard({}) === null);
check('a preparing phase yields null', readCard({ phase: 'preparing', block: {} }) === null);
check('a malformed meta yields null', readCard({ block: { meta: { fragment: 42 } } }) === null);

log(failures === 0 ? 'meta channel verified' : `${failures} meta check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
