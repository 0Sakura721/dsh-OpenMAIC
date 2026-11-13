# dsh-openmaic

OpenMAIC teaching cards for DeepSeek Harness: the model writes an interactive
lesson card — a concept explainer, a quiz, a step-by-step walkthrough, or a slide —
and it renders inline in the conversation.

No server, no database, no network. The card is a self-contained HTML document in
a sandboxed frame.

## Why this shape

This plugin used to embed the whole OpenMAIC web application: Next.js behind a
loopback proxy, framed in a panel. That approach failed three ways, each measured:

| Attempt | Failure |
| --- | --- |
| Cross-origin `iframe src` | The frame loaded and computed but was not painted; the panel stayed blank while the server reported healthy |
| `iframe srcdoc` of the whole app | Painted, but an `about:srcdoc` document has an **opaque origin**, so OpenMAIC's 254 absolute `fetch('/api/...')` calls resolved nowhere — every control was dead |
| Same-origin `/openmaic` prefix | OpenMAIC's absolute `/api` calls do not honour `basePath`, so they collided with the Harness's own `/api`; a proxy piping bodies through the Host's request handler wedged the entire Web UI |

Upstream [`THU-MAIC/dsh-openmaic`](https://github.com/THU-MAIC/dsh-openmaic) takes
the opposite approach and it is the correct one: never host the app. Ship the
*content* — a self-contained HTML artifact — into a sandboxed frame that needs no
backend. That is what this repository implements.

## What it contributes

| Piece | File |
| --- | --- |
| `openmaic_render` tool | [lib/index.js](lib/index.js) |
| Fragment contract + validator | [lib/fragment.mjs](lib/fragment.mjs) |
| Sandboxed teaching card (`tool.call.toolview`) | [lib/client.js](lib/client.js) |

## Install

```
plugin_manager → install_bundle → <absolute path to this directory>
```

Then restart the Harness.

## The card contract

The model passes an **inline HTML fragment**: markup, `<style>` and `<script>`
only. No `<!doctype>`, `<html>`, `<head>` or `<body>` — the card supplies the
document shell, and a pasted whole document would nest one document inside
another.

### Isolation

```html
<iframe sandbox="allow-scripts" srcdoc="…">
```

`allow-scripts` **without** `allow-same-origin` puts the card in an opaque origin:
it cannot read the Harness page, its storage, or its cookies. That is the entire
security model.

Inside the frame, a CSP confines further:

```
default-src 'none'
script-src  'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' <CDN allowlist>
style-src   'unsafe-inline' <CDN allowlist>
img-src / font-src / media-src  <CDN allowlist>
connect-src blob: data:        ← no network
frame-src 'none'  object-src 'none'  base-uri 'none'  form-action 'none'
```

Design consequences worth knowing when authoring a card:

- `fetch`, `XMLHttpRequest` and `WebSocket` are blocked. Compute locally.
- `localStorage` throws on an opaque origin. Keep state in memory.
- Static assets must come from the CDN allowlist (jsdelivr, unpkg, esm.sh,
  cdnjs, Google Fonts).
- `postMessage` reaches the host only to report the card's height.

The card reports its own height, so it grows with its content — a simulation that
resizes a canvas is handled, a fixed guess is not.

## Verification

```bash
node scripts/card-check.mjs
```

Parses the shipped bundle and asserts the properties that decide whether the card
is safe and wired correctly:

- `sandbox` is `allow-scripts` only, and `allow-same-origin` **never** appears;
- the frame CSP blocks network egress and nested frames;
- the card registers through `slots.inject`, not a bare `register` racing the slot
  declaration;
- the Host touches **no** `webServer` route (the exact mistake that wedged the UI);
- the Host has no network or database dependency.

## License

MIT. OpenMAIC itself is MIT, copyright the THU-MAIC authors.
