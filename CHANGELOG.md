# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions adhere to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-11-20

First stable release. Run THU-MAIC/OpenMAIC locally inside DeepSeek Harness with
an embedded database, a managed app process, and an in-chat control panel.

### The classroom opens in the browser

The panel does not embed the app. Every embedding approach was tried and measured:
a cross-origin iframe against the harness Host is never painted, and a `srcdoc`
copy renders (224 DOM nodes, 5 stylesheets) but never hydrates — React's runtime
does not initialise in `about:srcdoc`, leaving the server HTML with inert controls.
An in-panel frame is therefore not offered; instead the panel is an entry point
that opens the classroom in the system browser, where everything works.

- `openInBrowser()` launches the default browser (`start` / `open` / `xdg-open`).
- `POST /api/dsh-openmaic/open` reopens it on demand. Nothing opens on startup.
- `GET /api/dsh-openmaic/embed?redirect=1` 302s to the classroom URL.

### Local / cloud source switch

- Settings card selects `local` (the bundled instance, courses in the embedded
  database) or `cloud` (open.maic.chat, the user's own account and course library).
- Switching is instant and needs no restart; the local stack keeps running
  underneath, so coming back loses no data. `mode` persists in `runtime/settings.json`.

### Local stack

- Embedded PostgreSQL via PGlite 18.6 over a loopback wire socket.
- Managed OpenMAIC child process with a health probe and an agent tool
  (`openmaic_local`) that reports and controls state.
- Loopback reverse proxy rewrites `frame-ancestors` and answers CORS preflight.
- `ALLOW_LOCAL_NETWORKS` setting maps to OpenMAIC's SSRF opt-in, applied by
  recycling only the app child (the database and course data stay up).

### Notes

- Bundled OpenMAIC: `1.5.0-rc.2` (upstream `THU-MAIC/OpenMAIC`).
- Publishing through `scripts/publish-gh.mjs` remains available for environments
  where direct git TLS fails; normal releases use git tags and GitHub Releases.
- On machines with a broken schannel TLS backend, git operations need
  `GIT_SSL_NO_VERIFY=1` (a host environment workaround, not a code requirement).

[1.0.0]: https://github.com/0Sakura721/dsh-OpenMAIC/releases/tag/v1.0.0
