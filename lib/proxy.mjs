/**
 * Header-rewriting loopback reverse proxy.
 *
 * OpenMAIC bakes `Content-Security-Policy: frame-ancestors 'self'` and
 * `X-Frame-Options: SAMEORIGIN` into its routes manifest at build time. The
 * Harness Web UI runs on a different port (and therefore a different origin)
 * every time it starts, so a build-time allow-list cannot work.
 *
 * Rather than editing the built artifact, the plugin puts this proxy in front of
 * OpenMAIC and answers the two questions the browser actually asks:
 *  - may the Harness origin frame this page (`frame-ancestors`)?
 *  - may the framed document keep its cookie (`SameSite`)? Cookies are scoped by
 *    host, not port, so 127.0.0.1:<harness> and 127.0.0.1:<openmaic> are the
 *    same site and the session survives without any cookie juggling.
 *
 * Everything else is a transparent stream: SSE, chunked HTML, WebSocket upgrades
 * and file downloads pass through untouched, because buffering them would break
 * OpenMAIC's generation-run event streams.
 */

import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

/** Build the `frame-ancestors` value that admits the Harness origin. */
export function frameAncestorsFor(harnessOrigin) {
  const extra = new Set(["'self'"]);
  if (harnessOrigin) extra.add(harnessOrigin);
  // Loopback in any port, so a Harness restart on a fresh port keeps working.
  extra.add('http://127.0.0.1:*');
  extra.add('http://localhost:*');
  return [...extra].join(' ');
}

/** Replace only the `frame-ancestors` directive of an existing CSP value. */
export function rewriteCsp(value, harnessOrigin) {
  const ancestors = `frame-ancestors ${frameAncestorsFor(harnessOrigin)}`;
  if (!value) return ancestors;
  const parts = value
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part !== '' && !/^frame-ancestors\b/i.test(part));
  parts.push(ancestors);
  return parts.join('; ');
}

/**
 * Rewrite one upstream response's headers in place-safe form: returns a new
 * plain object, never mutating the upstream instance.
 *
 * Three changes, each with a distinct reason:
 *
 * - `X-Frame-Options` is dropped because it only offers `SAMEORIGIN`, which would
 *   forbid the Harness origin outright.
 * - The CSP's `frame-ancestors` is rewritten to admit that origin.
 * - `Access-Control-Allow-Origin: *` is added. A `srcdoc` document has an opaque
 *   origin, so the browser treats every `/_next/` module it loads as a cross-origin
 *   script request and refuses it without CORS — measured as
 *   "blocked by CORS policy: No 'Access-Control-Allow-Origin'", after which the app
 *   renders its first paint and then never hydrates. Nothing here is secret: the
 *   proxy is loopback-only and every byte it serves is already reachable at that
 *   loopback origin.
 */
export function rewriteResponseHeaders(headers, harnessOrigin) {
  const next = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (lower === 'x-frame-options') continue;
    if (lower === 'content-security-policy') {
      next[key] = rewriteCsp(Array.isArray(value) ? value.join('; ') : String(value), harnessOrigin);
      continue;
    }
    if (lower === 'content-security-policy-report-only') continue;
    // Upstream's own CORS verdict is replaced below, not duplicated.
    if (lower === 'access-control-allow-origin') continue;
    if (lower === 'access-control-allow-credentials') continue;
    next[key] = value;
  }
  next['Access-Control-Allow-Origin'] = '*';
  return next;
}

/**
 * Start the proxy.
 *
 * `target` is the OpenMAIC origin, for example `http://127.0.0.1:3311`.
 * Resolves to `{ origin, port, close() }`.
 */
export async function startFrameProxy({ target, harnessOrigin, port = 0, host = '127.0.0.1', logger }) {
  const upstream = new URL(target);
  const isHttps = upstream.protocol === 'https:';
  const requestImpl = isHttps ? httpsRequest : httpRequest;
  const upstreamPort = Number(upstream.port) || (isHttps ? 443 : 80);

  const server = createHttpServer((req, res) => {
    // Answer CORS preflight here rather than upstream: the app is same-origin with
    // itself and never expects a preflight, so it would answer with a 404/405 and
    // the browser would refuse the real request. The frame's opaque origin means
    // every non-simple call (JSON bodies, PUT/DELETE) needs one.
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS',
        'access-control-allow-headers':
          req.headers['access-control-request-headers'] ?? 'content-type,authorization',
        'access-control-max-age': '600',
        'content-length': '0',
      });
      res.end();
      return;
    }

    const headers = { ...req.headers, host: upstream.host };
    for (const key of Object.keys(headers)) {
      if (HOP_BY_HOP.has(key.toLowerCase())) delete headers[key];
    }
    const proxied = requestImpl(
      {
        protocol: upstream.protocol,
        hostname: upstream.hostname,
        port: upstreamPort,
        method: req.method,
        path: req.url,
        headers,
      },
      (upstreamRes) => {
        res.writeHead(
          upstreamRes.statusCode ?? 502,
          upstreamRes.statusMessage,
          rewriteResponseHeaders(upstreamRes.headers, harnessOrigin),
        );
        upstreamRes.pipe(res);
        upstreamRes.on('error', () => res.destroy());
      },
    );
    proxied.on('error', (error) => {
      logger?.(`dsh-openmaic proxy: upstream error for ${req.url}: ${error?.message ?? error}`);
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('OpenMAIC is not reachable on its loopback port.');
      } else {
        res.destroy();
      }
    });
    req.pipe(proxied);
  });

  // WebSocket upgrades (Next.js dev HMR and any SSE-over-upgrade route).
  server.on('upgrade', (req, socket, head) => {
    const headers = { ...req.headers, host: upstream.host };
    for (const key of Object.keys(headers)) {
      if (HOP_BY_HOP.has(key.toLowerCase()) || key.toLowerCase() === 'sec-websocket-key') {
        // keep the key; only drop hop-by-hop
      }
    }
    const proxied = requestImpl({
      protocol: upstream.protocol,
      hostname: upstream.hostname,
      port: upstreamPort,
      method: req.method,
      path: req.url,
      headers,
    });
    proxied.on('upgrade', (upstreamRes, upstreamSocket, upstreamHead) => {
      const lines = [`HTTP/1.1 ${upstreamRes.statusCode} ${upstreamRes.statusMessage ?? 'OK'}`];
      for (const [key, value] of Object.entries(upstreamRes.headers)) {
        if (Array.isArray(value)) for (const item of value) lines.push(`${key}: ${item}`);
        else if (value !== undefined) lines.push(`${key}: ${value}`);
      }
      socket.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (upstreamHead?.length) socket.write(upstreamHead);
      if (head?.length) upstreamSocket.write(head);
      upstreamSocket.pipe(socket);
      socket.pipe(upstreamSocket);
      upstreamSocket.on('error', () => socket.destroy());
      socket.on('error', () => upstreamSocket.destroy());
    });
    proxied.on('error', () => socket.destroy());
    proxied.end();
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });

  const actualPort = server.address().port;
  let closed = false;
  return {
    port: actualPort,
    origin: `http://${host}:${actualPort}`,
    close() {
      if (closed) return;
      closed = true;
      try {
        server.close();
      } catch {}
    },
  };
}
