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
plan, then applies the Installation. The generated root owns the Worker,
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
Capsule should create D1 / R2 / KV / Queue resources. Runtime surfaces are
published through the generic `service_exports` output, runtime grant requests
use `service_bindings`, and post-apply app setup is declared through the neutral
`takosumi_release.post_apply` output as an opaque command. The contract is:
OpenTofu provisions resources, Takosumi records outputs and run history, and the
app-owned post-apply command performs Yurucommu-specific activation.

`app:activate` is Yurucommu-owned code, not a Takosumi DB migration API.
Takosumi only starts the opaque argv declared in `takosumi_release.post_apply`
and records activation status/logs. The operator activation environment provides
the SQL execution argv either as a prefix (`YURUCOMMU_SQL_COMMAND_JSON`) or a
template (`YURUCOMMU_SQL_COMMAND_TEMPLATE_JSON`, with `{resource}` and `{sql}`
placeholders). No Yurucommu-specific manifest format or DSL is required.

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
