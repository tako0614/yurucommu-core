# Yurucommu

Japanese: [README.ja.md](README.ja.md)

Yurucommu is a self-hosted, single-user ActivityPub social product.

It is designed around personal domains, self-owned data, and community-sized relationships rather than algorithmic feeds.

The project aims to keep the repo self-contained enough that a contributor can understand the runtime model, local setup, and deployment shape from this repository alone.

## Highlights

- Self-hosted by default, with a low-cost Cloudflare-oriented runtime model
- ActivityPub-compatible and intended to interoperate with Mastodon and Misskey-style servers
- Focused on small communities and interest-based connections

## Design Direction

- human-scale relationships over recommendation feeds
- community-sized social spaces over mass-audience timelines
- self-hosted control over identity, domain, and data
- standards-based federation through ActivityPub

## Tech Stack

- Runtime: Cloudflare Workers
- Database: Cloudflare D1
- Storage: Cloudflare R2
- Backend: Hono
- Web UI: SolidJS + Vite
- Protocol: ActivityPub

## Repository Map

- `src/backend`: Hono routes, middleware, runtime code, and backend tests
- `src/db`: schema and database-related code
- `src/plugin`: reusable plugin surface
- `src/runtime`: runtime helpers
- `web/`: Vite-based web UI
- `site/`: static project website assets
- `migrations/`: database migrations
- `wrangler.toml`, `wrangler.local.toml`, `wrangler.site.toml`: deployment and environment-specific config

## Quickstart

```bash
cd yurucommu
deno task dev
```

This starts the Cloudflare Worker-oriented local development flow.

For web UI development:

```bash
cd yurucommu
deno task dev:web
```

For tests and linting:

```bash
cd yurucommu
deno task test
deno task lint
```

Database helpers:

```bash
cd yurucommu
deno task db:generate
deno task db:push
deno task db:studio
```

## Deploy

Main application:

```bash
cd yurucommu
deno task deploy
```

Static site:

```bash
cd yurucommu
deno run -A npm:wrangler deploy --config wrangler.site.toml
```

## Configuration Notes

- Use `.env.example` as the starting point for local configuration
- Keep tracked config safe for OSS use; do not commit secrets or production-only identifiers
- If you change public behavior, update `README.md` and related examples along with the code

## Documentation Strategy

Yurucommu currently uses the repository README and in-repo config examples as its primary public entrypoint.
If the product grows additional docs, keep this README as the short overview and navigation page.

## License And Contributing

Licensed under GNU AGPL v3. See `LICENSE`.

See `CONTRIBUTING.md` and `SECURITY.md` for contribution and security guidance.
