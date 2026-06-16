# Yurucommu

Yurucommu is a **self-hosted ActivityPub community social app** built for your
own domain, your own data, and small-community-scale connections. It federates
with the wider fediverse (Mastodon / Misskey and other ActivityPub servers) and
runs cheaply on Cloudflare. Yurucommu is an independent product: it ships as a
first-party bundled app with the [Takos](https://takos.jp) distribution, but it
runs standalone without Takos.

## Features

- **ActivityPub federation** — follow, post, boost, like, and reply across the
  fediverse, with HTTP-signature verification, SSRF-guarded fetches, and
  actor/domain blocklists.
- **Timeline & posts** — home timeline, post detail, replies, bookmarks.
- **Direct messages** — end-to-end-style private conversations.
- **Communities** — group spaces with chat and profiles.
- **Stories** — ephemeral media with a composer and viewer.
- **Search, notifications, recommendations** — discover people and content.
- **Auth** — password, Google / X OAuth, and Takosumi Accounts OIDC consumer.
- **Bilingual UI** — Japanese / English.

## Self-host

Yurucommu deploys to Cloudflare Workers. There are two supported paths.

### 1. Direct self-host (wrangler)

Provision and deploy the Worker yourself:

```bash
bun install
bun run build           # vite build of the browser UI
bunx wrangler deploy --config wrangler.toml
```

Configure the Worker via `wrangler.toml` (`[vars]`) and `wrangler secret put`
for `ENCRYPTION_KEY`, auth credentials, and OAuth secrets. See
[`.env.example`](.env.example) and the
[deployment guide](https://yurucommu.com/help/deployment.html) for the full
variable list, D1 / R2 / KV / Queue bindings, and migration steps.

### 2. Bundled app with Takos

Yurucommu is registered as a first-party default app in the Takos distribution
and auto-installs into new Workspaces. The app exposes its deploy topology as a
plain OpenTofu Capsule manifest ([`outputs.tf`](outputs.tf), the `takos_app`
output) describing its compute, resources (D1 / R2 / KV / delivery queue +
DLQ), routes, secrets, and launcher publication. The Takos distribution reads
this manifest, provisions the resources, and publishes the launcher surface. No
Yurucommu-specific manifest format or DSL is required.

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
is a normal Installation a user can uninstall, and it is never absorbed into
Takos core. See [`AGENTS.md`](AGENTS.md) for the full product boundary.

## Documentation

- [Deployment guide](https://yurucommu.com/help/deployment.html)
- [Getting started](https://yurucommu.com/help/getting-started.html)
- [Help site](https://yurucommu.com/help/)
