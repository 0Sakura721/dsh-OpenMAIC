# OpenMAIC

OpenMAIC (Open Multi-Agent Interactive Classroom) is an open-source AI classroom
platform from the THU-MAIC group: any topic or document becomes a multi-agent
lesson — slides, quizzes, interactive simulations and project-based learning,
delivered by AI teachers and AI classmates that speak, draw on a whiteboard and
discuss in real time.

This repository turns https://github.com/THU-MAIC/OpenMAIC into a **first-class
DeepSeek Harness plugin** that runs **entirely on your machine**: no Docker, no
external PostgreSQL, no cloud dependency.

## What it installs

| Layer | Implementation | Notes |
| --- | --- | --- |
| Database | embedded **PGlite 18.6** + `pglite-socket` | PostgreSQL compiled to WASM, exposed as a real wire-protocol listener on `127.0.0.1:<random port>`. OpenMAIC's own `pg` driver connects to it, so every migration and query runs unmodified |
| App | managed **OpenMAIC standalone server** | `.next/standalone/server.js` as a child process; output is folded into the Harness log and the whole tree is killed on dispose |
| Embedding | **header-rewriting reverse proxy** | OpenMAIC bakes `frame-ancestors 'self'` at build time while the Harness port changes every restart; the proxy rewrites that header at runtime so the iframe is allowed |
| UI | sidebar entry + main panel + settings card | the panel is a full-height iframe; when stopped it offers start/retry and shows the raw error |
| Tool | `openmaic_local` | the agent can query, start, stop and restart the local classroom server |

## Install

```bash
# 1) Prepare the OpenMAIC checkout and its production build (idempotent)
node scripts/setup-openmaic.mjs

# 2) Install the plugin into the current Harness profile
#    In a Harness session: plugin_manager -> install_bundle -> absolute path of this directory
```

After installation the plugin starts the local stack automatically: a
**Classroom** entry appears in the sidebar and the main panel *is* OpenMAIC.

Installing changes the profile's package set, so the Harness asks for a restart
the first time.

### Optional dependencies

The database driver ships as `optionalDependencies`:

```
@electric-sql/pglite          ^0.5.15
@electric-sql/pglite-socket   ^0.2.18
```

If an install skips optional dependencies, startup reports it explicitly instead
of failing silently. You can also point `config.databaseUrl` at an existing
PostgreSQL and skip the embedded database entirely.

## Configuration

The `cordis.patch.yml` row accepts a `config` block; every field has a safe
default:

| Field | Default | Meaning |
| --- | --- | --- |
| `autoStart` | `true` | bring the stack up with the Harness |
| `appDir` | `vendor/OpenMAIC` | the OpenMAIC checkout |
| `databaseUrl` | `''` (embedded) | set to use an external PostgreSQL |
| `dataDir` | `runtime/pgdata` | embedded data directory — every course lives here |
| `appPort` / `proxyPort` | `0` (automatic) | pin the ports when needed |
| `startupTimeoutMs` | `300000` | total health-check budget |
| `env` | `{}` | extra environment passed to OpenMAIC |

Deleting `runtime/pgdata` deletes every course.

## Two honest limits

1. **LISTEN/NOTIFY does not cross the socket layer.** OpenMAIC's wakeup bus falls
   back to polling. Correctness is unaffected — the durable event log is the
   source of truth — only stream latency degrades slightly.
2. **One database is multiplexed over many connections.** `pglite-socket`
   serializes concurrent write transactions. That is fine for a personal local
   classroom; it is not a multi-tenant deployment.

Both are properties of running PostgreSQL-in-WASM locally, not defects this
plugin can fix by configuration.

## Verification

Three checks, each independent of the Harness UI:

```bash
node scripts/smoke.mjs             # stack, proxy, framed page, rewritten headers
node scripts/host-check.mjs        # apply() against a fake Cordis context, stopped -> running -> stopped
node scripts/persistence-check.mjs # write a folder, stop the stack, start it again, read it back
node scripts/inspect-db.mjs        # every table and row count in the embedded database
```

`smoke` asserts that the page answers 200, that `frame-ancestors` admits the
Harness origin, and that `X-Frame-Options` is gone. `persistence-check` is the
one that matters for users: a folder written through the proxied origin is still
there after the plugin's own stop/start cycle.

## License

Plugin code: MIT. OpenMAIC itself is MIT, copyright the THU-MAIC authors;
`vendor/OpenMAIC` is a local checkout that never ships with this package.
