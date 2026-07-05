# Yurucommu Core

Yurucommu Core is the **server, ActivityPub, API, and OpenTofu Capsule** for a
self-hosted social instance you run for yourself. It owns the data model,
federation, deploy topology, and typed client SDK. It does not own the official
feed client UI or Yurumeet UI; those live in separate client repositories and
connect to this server through discovery outputs and `@takosjp/yurucommu-api`.

The public product remains **yurucommu**. The `yurucommu` repository owns the
official feed / story / profile client and `yurucommu.com`. **Yurumeet** is a
separate LINE-like talk client brand for the same server API. `yurume` is the
short client id and abbreviation for Yurumeet.

## Features

- **ActivityPub federation** — follow, post, boost, like, and reply across
  servers to link your communities and connections, with HTTP-signature
  verification, SSRF-guarded fetches, and actor/domain blocklists.
- **Server API** — actor, post, story, DM, community, media, notification, and
  mobile-push routes.
- **Client contract** — a typed SDK and discovery outputs for yurucommu,
  Yurumeet, mobile, and alternate clients.
- **Search, notifications, recommendations** — discover people and content.
- **Auth** — password, Google / X OAuth, and Takosumi Accounts OIDC consumer.
- **Bilingual UI** — Japanese / English.

## Self-host

Yurucommu deploys as a plain OpenTofu Capsule. A self-hoster installs the Git
URL / ref / module path through Takosumi, reviews the Compatibility Report and
plan, then applies the Capsule run. The generated root owns the Worker,
D1 / R2 / KV / Queue bindings, routes, and secret references; repository-local
Wrangler files are contributor/debug material, not the product install path.
See [`.env.example`](.env.example) and the
[deployment guide](https://yurucommu.com/help/deployment.html) for the runtime
variable names and local development notes.

### Installable Capsule

Yurucommu exposes its deploy topology as a plain OpenTofu Capsule. Users add it
explicitly from a Git URL / ref / module path; it is not auto-installed into new
Takos Workspaces by default. Cloudflare backing resources are normal
`cloudflare/cloudflare` provider resources in [`main.tf`](main.tf); set
`enable_cloudflare_resources=true` and provide `cloudflare_account_id` when the
Capsule should create D1 / R2 / KV / Queue resources. For the fully
OpenTofu-managed path, publish a prebuilt Capsule Worker artifact from Git CI and
set `enable_cloudflare_worker_script=true`. The preferred artifact is the public
GitHub Release asset produced by
[`.github/workflows/worker-release-artifact.yml`](.github/workflows/worker-release-artifact.yml):
`takos-worker.js`, `takos-worker.js.sha256`, and `takosumi-artifact.json`. The
module accepts either a local `worker_bundle_path` or an HTTPS
`worker_bundle_url` plus `worker_bundle_sha256`; OpenTofu reads that artifact,
verifies the checksum, and the `cloudflare/cloudflare` provider manages the
Worker script upload, bindings, queue consumers, route, and optional workers.dev
enablement. The default Capsule Worker artifact embeds the web assets, so
Cloudflare Workers static assets are optional and disabled by default. Runtime
surfaces are published through the generic `service_exports` output and runtime
grant requests use `service_bindings`.

The Capsule also publishes client-neutral social server outputs:
`social_api_base_url`, `activitypub_origin`, `media_origin`,
`social_server_capabilities_url`, and `mobile_push_registration_url`. Client
Capsules such as Yurumeet should consume those outputs as normal Takosumi
Output-to-input dependencies instead of relying on a Takosumi-owned official
client registry.

Client implementations should use the public typed SDK package
`@takosjp/yurucommu-api` instead of importing server repo internals. The package
contains the transport hooks, server discovery types, API fetchers, and shared
actor/post/story/DM/community/notification/mobile-push types used by the default
web UI, Yurumeet, and future mobile shells.

For Takosumi Cloud's Cloudflare-compatible endpoint, use the same
`cloudflare/cloudflare` provider with the Takosumi-provided `base_url`, token,
and virtual account / zone values. Prefer an explicit Worker route for managed
hostnames: set `enable_workers_dev_subdomain=false`,
`cloudflare_route_zone_id=<virtual-zone-id>`,
`cloudflare_route_pattern=<name>.app.takos.jp/*`, and `app_url` to the matching
HTTPS URL. Provide the Git CI release artifact URL and sha through
`worker_bundle_url` and `worker_bundle_sha256` so the Git module can run without
repository-local `dist/` files. The checksum may be raw lowercase hex or
`sha256:<hex>`. For real Cloudflare, the same route variables can point at a
real zone.

The contract is: OpenTofu provisions declared resources, Takosumi injects
credentials and records state / outputs / run history, and app-owned post-apply
commands are only used for app initialization that is not a Cloudflare resource
itself. In the OpenTofu-managed Worker path, `takosumi_release.post_apply` runs
Yurucommu D1 migrations only in the runner boundary; it does not deploy the
Worker a second time or wait for an operator materializer.

`takosumi:release` is Yurucommu-owned code, not a Takosumi DB migration or Worker
deployment API. Takosumi only starts the opaque argv declared in
`takosumi_release.post_apply` and records activation status/logs. The fallback
command reads non-secret OpenTofu outputs from `TAKOSUMI_OUTPUTS_JSON`, renders a
temporary Wrangler config, installs dependencies with `bun install
--frozen-lockfile`, applies Yurucommu D1 migrations, and deploys the Worker
artifact only when `enable_cloudflare_worker_script=false`. Operator secrets
such as `YURUCOMMU_ENCRYPTION_KEY`,
`YURUCOMMU_AUTH_PASSWORD_HASH`, or OAuth client secrets must come from the
selected release execution boundary. In the normal Takosumi path this is the
runner boundary for migrations-only activation because the Worker itself is
already managed by OpenTofu. In the fallback release path where Wrangler deploys
the Worker artifact, this is the operator release activator, which may provide
explicitly allowlisted environment values. These secrets are uploaded as Worker
secrets and are never stored in OpenTofu outputs. The source repo remains a
plain Git-hosted OpenTofu module; no Yurucommu-specific source metadata file or
DSL is required.

## Develop

```bash
cd yurucommu-core
bun install
bun run check   # tsc --noEmit
bun test        # bun:test suite
bun run lint    # type check
bun run fmt     # prettier
```

The backend Worker source lives in `src/backend` (Hono routes, ActivityPub
federation, delivery pipeline), the shared npm API package in `packages/api`,
and the database schema and migrations in `src/db/schema` and `migrations/`.

API package commands:

```bash
bun run build:api  # build @takosjp/yurucommu-api
bun run pack:api   # npm pack --dry-run for the API package
```

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

- [Deployment guide](https://yurucommu.com/help/deployment.html)
- [Getting started](https://yurucommu.com/help/getting-started.html)
- [Help site](https://yurucommu.com/help/)
