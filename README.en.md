日本語: [README.md](README.md)

# Yurucommu Core

Yurucommu Core is the shared **ActivityPub / API / DB / runtime engine library**
for the yurucommu family. It is not the installable product repo and it does not
own an OpenTofu Capsule.

The deployable products are separate repositories:

- `yurucommu` owns the feed / story / profile fullstack product, `yurucommu.com`,
  its Worker artifact, and its OpenTofu Capsule.
- `yurumeet` owns the talk-first fullstack product. `yurume` is the short client
  id / abbreviation used in discovery and push registration.

## Features

- **ActivityPub federation** — follow, post, boost, like, and reply across
  servers to link your communities and connections, with HTTP-signature
  verification, SSRF-guarded fetches, and actor/domain blocklists.
- **Server API** — actor, post, story, DM, community, media, notification, and
  mobile-push routes.
- **Client contract** — a typed SDK and discovery types for yurucommu,
  yurumeet, mobile, and alternate clients.
- **Search, notifications, recommendations** — discover people and content.
- **Auth** — password, Google / X OAuth, and Takosumi Accounts OIDC consumer.
- **Bilingual UI** — Japanese / English.

## Deployment Boundary

Do not install this repo as a Capsule. Install `yurucommu` or `yurumeet`
instead. Those product repos bundle their own UI with this server engine, publish
their own Worker artifact, and expose their own plain OpenTofu module.

Client implementations should use `@takosjp/yurucommu-api`. Product Worker
artifacts use `@takosjp/yurucommu-core/server` to create the Hono backend and
`@takosjp/yurucommu-core/migrations` for D1 migration activation. They should
not import unpublished source paths from this checkout.

## Develop

```bash
cd yurucommu-core
bun install
bun run check   # complete portable gate
bun run test    # portable suites and packaged-consumer checks
bun run lint    # alias of the complete portable gate
bun run fmt     # prettier
```

The backend engine source lives in `src/backend` (Hono routes, ActivityPub
federation, delivery pipeline), the shared npm API package in `packages/api`,
and the database schema and migrations in `src/db/schema` and `migrations/`.

`bun run check` is the complete portable gate: format checks, TypeScript /
static analysis, portable tests, the API build, Worker / browser bundles, and
packed-consumer checks. A green routine CI run proves this portable gate.

### Linux procfs native verification

The two real kernel probes for a sibling PID namespace owner and `hidepid=2`
live separately in `test-native/`. Run this separate cadence on a Linux host
that already has the required capabilities:

```bash
bun run check:native:linux-procfs
```

The entrypoint requires Linux and `unshare` / `mount` / `setpriv`. Ten-second
prerequisite probes check PID namespaces, procfs mounts, `hidepid=2`, and
execution as both probe UIDs. Missing tools or denied namespace / mount rights
produce raw diagnostics and a nonzero exit. After the prerequisites pass, the
current Bun runs both tests unconditionally and preserves their failure status.
The entire native suite has a 60-second limit. A timeout prints a diagnostic,
returns status `124`, and terminates only the suite's own process group. Normal
exit also cleans up any remaining children in that group.
The command does not install tools or grant privileges. Green portable CI does
not prove that this Linux native verification passed.

API package commands:

```bash
bun run build:api  # build @takosjp/yurucommu-api
bun run pack:api   # npm pack --dry-run for the API package
```

### Release order for notification support in 3.1.0

The browser notification public API and `0019_notification_push_delivery.sql` become part of the core/API contract in
`3.1.0`. Publish both packages from the same `v3.1.0` tag and require the packed-consumer gate to pass first. Only after
that version is available from the npm registry may `yurucommu` and `yurumeet` update their dependency ranges and
`bun.lock` files from the registry. Each product must then pass `bun run check:core-release` before releasing its Worker.
Do not substitute unpublished source through a `file:`, `workspace:`, or Git dependency.

Yurumeet and mobile clients live in separate repositories. They should depend on
`@takosjp/yurucommu-api`, discover a server through Capsule outputs or
`/.well-known/social-server`, and deploy their own static/runtime artifact
through Takosumi, Cloudflare, or a self-host runtime. Local checkouts can be
placed under `clients/` for debugging, but that directory is intentionally
ignored so the server repo stays small.

When a client runs on a separate origin, the yurucommu-server must include that
origin in its CORS / CSRF allowlist.

## Boundaries

Yurucommu implements its own ActivityPub federation, content distribution, and
user identity entirely at the app layer — it does not depend on Takos core
services or on a platform-layer federation mechanism. When installed through
Takosumi it is a normal Capsule a user can remove, and it is never absorbed into
Takos core. See [`AGENTS.md`](AGENTS.md) for the full product boundary.

## Documentation

- [Runtime lanes](docs/design/runtime-lanes.md) — how the bindings differ between
  a raw-Cloudflare deployment and one on a host that projects the portable
  facades, and how a deployment declares which it is
- [Deployment guide](https://yurucommu.com/help/deployment.html)
- [Getting started](https://yurucommu.com/help/getting-started.html)
- [Help site](https://yurucommu.com/help/)
