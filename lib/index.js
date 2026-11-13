/**
 * dsh-openmaic — OpenMAIC teaching cards for DeepSeek Harness.
 *
 * This plugin does **not** embed the OpenMAIC web application. An earlier attempt
 * did: it ran Next.js behind a loopback proxy and framed it. That fails on three
 * counts, all observed:
 *
 *  - A cross-origin frame over the Host's window is not reliably painted, so the
 *    panel stayed blank while reporting a healthy server.
 *  - `srcdoc` paints, but its document has an opaque origin, so the app's 254
 *    absolute `fetch('/api/...')` calls resolve nowhere and nothing is clickable.
 *  - A same-origin `/openmaic` prefix collides with the Harness's own `/api`, and
 *    a proxy that pipes bodies through the Host's request handler can wedge the
 *    whole Web UI.
 *
 * Upstream `THU-MAIC/dsh-openmaic` solves this the other way round: it never hosts
 * the app. It ships the *content* — a teaching card as a self-contained HTML
 * document — into a sandboxed frame that needs no backend. That is what this file
 * implements: one tool, one card, no server.
 *
 *   openmaic_render  inline HTML teaching card → sandboxed frame in the chat
 *
 * The model writes the card; the browser half draws it. Nothing here touches the
 * filesystem, the network, or the Host's own routes.
 */

import { MAX_FRAGMENT_BYTES, RENDER_TOOL_NAME, validateFragment } from './fragment.mjs';

export const name = 'dsh-openmaic';

/** Services this plugin needs. No `webServer`, so it can never affect routing. */
export const inject = ['tools', 'systemPrompt'];

const PROMPT_SECTION = `## Render an OpenMAIC teaching card (openmaic_render)

Use openmaic_render when a picture teaches better than prose: explaining a
concept, checking understanding with a quiz, walking through an algorithm or a
multi-step process, or showing a slide.

Write the card as an **inline HTML fragment** — markup, \`<style>\`, and
\`<script>\` only. Do not emit \`<!doctype>\`, \`<html>\`, \`<head>\`, or \`<body>\`;
the card supplies its own document shell.

The card renders inside \`<iframe sandbox="allow-scripts">\`, which means an opaque
origin with no access to the Harness page and no network. Consequences worth
designing around:

- \`fetch\`, \`XMLHttpRequest\` and \`WebSocket\` are blocked by the frame's own CSP.
  Write cards that compute locally; do not call an API.
- \`localStorage\` throws on an opaque origin. Keep state in memory.
- \`postMessage\` reaches the host only to report height; use it for nothing else.
- Static assets may come from a fixed CDN allowlist (cdn.jsdelivr.net, unpkg.com,
  esm.sh, cdnjs.cloudflare.com, fonts.googleapis.com, fonts.gstatic.com).

Text in the host's own language, self-contained styles, and no external network
calls beyond that allowlist. The card is rendered once and stored verbatim, so it
must look right without any second request.`;

/**
 * Mount the plugin.
 *
 * @param ctx - Host context; only `tools` and `systemPrompt` are touched.
 */
export function apply(ctx) {
  // The prompt section explains the frame's constraints once, so the model does
  // not have to rediscover them from a tool error on every call.
  ctx.effect(() => {
    const systemPrompt = ctx.get?.('systemPrompt') ?? ctx.systemPrompt;
    if (!systemPrompt || typeof systemPrompt.section !== 'function') return undefined;
    return systemPrompt.section({
      name: 'dsh-openmaic:cards',
      order: 150,
      text: PROMPT_SECTION,
      interpolate: false,
    });
  });

  ctx.effect(() => {
    const tools = ctx.get?.('tools') ?? ctx.tools;
    if (!tools || typeof tools.register !== 'function') return undefined;

    return tools.register({
      name: RENDER_TOOL_NAME,
      description:
        'Show the user an interactive OpenMAIC teaching card (a concept card, quiz, ' +
        'step-by-step walkthrough, or slide) rendered inline in the conversation. ' +
        'Pass the markup in `fragment`: literal inline HTML only, no document skeleton.',
      parameters: {
        type: 'object',
        properties: {
          fragment: {
            type: 'string',
            description:
              'The inline HTML fragment to render (markup, style, and script; no ' +
              '<!doctype>, <html>, <head>, or <body>).',
          },
          title: {
            type: 'string',
            description: 'Concise card title. Defaults to "OpenMAIC 课堂".',
          },
        },
        required: ['fragment'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            sizeBytes: { type: 'integer' },
            fragment: { type: 'string' },
          },
          required: ['title', 'sizeBytes', 'fragment'],
        },
        // The model wrote the fragment itself, so the result stays a one-line
        // confirmation. The card reads `fragment` from the tool's meta instead of
        // re-reading it out of context.
        render: (_args, value) => [
          {
            type: 'text',
            text: `已渲染教学卡片《${value?.title ?? ''}》（${value?.sizeBytes ?? 0} 字节）。`,
          },
        ],
      },
      isConcurrencySafe: () => true,
      async execute(args) {
        const fragment = typeof args?.fragment === 'string' ? args.fragment : '';
        const title = typeof args?.title === 'string' && args.title.trim() !== ''
          ? args.title.trim()
          : 'OpenMAIC 课堂';

        // Reject the two mistakes that produce a broken card instead of a useful
        // error: an empty body, and a whole document pasted where a fragment goes.
        const problem = validateFragment(fragment, MAX_FRAGMENT_BYTES);
        if (problem) throw new Error(`openmaic_render: ${problem}`);

        return {
          title,
          sizeBytes: Buffer.byteLength(fragment, 'utf8'),
          fragment,
        };
      },
    });
  });
}

export default { name, inject, apply };
