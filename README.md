# Yurucommu

Yurucommu is a **self-hosted ActivityPub SNS you run for yourself** — on your
own domain, with your own data, free from algorithms and platform lock-in, and
running cheaply on Cloudflare. Its reach unit is the community (group): the goal
is not to broadcast across the whole fediverse, but to keep dense connections
within a community while follow graphs and communities extend that reach. ActivityPub
federation is the substrate, not the goal — it keeps you independent of any single
platform and links communities and connections across servers (Mastodon / Misskey
and other ActivityPub servers). The three content types are Note (posts, surfaced
as Post in the UI), Messaging (DMs, carried as direct-addressed Notes), and Story
(ephemeral media). Communities (groups) are a feature inside your personal
instance, not the headline. Yurucommu is an independent product: it ships as a
first-party bundled app with the [Takos](https://takos.jp) distribution, but it
runs standalone without Takos.

## Features

- **ActivityPub federation** — follow, post, boost, like, and reply across
  servers to link your communities and connections, with HTTP-signature
  verification, SSRF-guarded fetches, and actor/domain blocklists.
- **Timeline & posts** — home timeline, post detail, replies, bookmarks.
- **Direct messages** — end-to-end-style private conversations.
- **Communities** — group spaces with chat and profiles.
- **Stories** — ephemeral media with a composer and viewer.
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

### Bundled app with Takos

Yurucommu is registered as a first-party default app in the Takos distribution
and auto-installs into new Workspaces. The app exposes its deploy topology as a
plain OpenTofu Capsule. Cloudflare backing resources are normal
`cloudflare/cloudflare` provider resources in [`main.tf`](main.tf); set
`enable_cloudflare_resources=true` and provide `cloudflare_account_id` when the
Capsule should create D1 / R2 / KV / Queue resources. For the fully
OpenTofu-managed path, publish a prebuilt Capsule Worker artifact with
`bun run build:capsule-worker` and set `enable_cloudflare_worker_script=true`.
The module accepts either a local `worker_bundle_path` or an HTTPS
`worker_bundle_url` plus `worker_bundle_sha256`; OpenTofu reads that artifact and
the `cloudflare/cloudflare` provider manages the Worker script upload, bindings,
queue consumers, route, and optional workers.dev enablement. The default
Capsule Worker artifact embeds the web assets, so Cloudflare Workers static
assets are optional and disabled by default. Runtime surfaces are published
through the generic `service_exports` output and runtime grant requests use
`service_bindings`.

For Takosumi Cloud's Cloudflare-compatible endpoint, use the same
`cloudflare/cloudflare` provider with the Takosumi-provided `base_url`, token,
and virtual account / zone values. Prefer an explicit Worker route for managed
hostnames: set `enable_workers_dev_subdomain=false`,
`cloudflare_route_zone_id=<virtual-zone-id>`,
`cloudflare_route_pattern=<name>.app.takos.jp/*`, and `app_url` to the matching
HTTPS URL. Provide a release artifact URL and sha through `worker_bundle_url` and
`worker_bundle_sha256` so the Git module can run without repository-local
`dist/` files. For real Cloudflare, the same route variables can point at a real
zone.

The contract is: OpenTofu provisions declared resources, Takosumi injects
credentials and records state / outputs / run history, and app-owned post-apply
commands are only used for app initialization that is not a Cloudflare resource
itself. In the OpenTofu-managed Worker path, `takosumi_release.post_apply` runs
Yurucommu D1 migrations only; it does not deploy the Worker a second time.

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
operator release activator, which may provide explicitly allowlisted
environment values. These secrets are uploaded as Worker secrets and are never
stored in OpenTofu outputs. The source repo remains a plain Git-hosted
OpenTofu module; no Yurucommu-specific source metadata file or DSL is required.

## Develop

```bash
cd yurucommu
bun install
bun run check   # tsc --noEmit
bun test        # bun:test suite
bun run lint    # type check
bun run fmt     # prettier
```

The backend Worker source lives in `src/backend` (Hono routes, ActivityPub
federation, delivery pipeline), the browser UI in `web/src` (Solid), the
database schema and migrations in `src/db/schema` and `migrations/`.

## Boundaries

Yurucommu implements its own ActivityPub federation, content distribution, and
user identity entirely at the app layer — it does not depend on Takos core
services or on a platform-layer federation mechanism. As a Takos bundled app it
is a normal Capsule a user can remove, and it is never absorbed into
Takos core. See [`AGENTS.md`](AGENTS.md) for the full product boundary.

## Documentation

- [Deployment guide](https://yurucommu.com/help/deployment.html)
- [Getting started](https://yurucommu.com/help/getting-started.html)
- [Help site](https://yurucommu.com/help/)
