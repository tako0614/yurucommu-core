# Deploying the yurucommu.com website

`site/` is a static site (landing + `help/` docs + `specs/` ActivityPub specs +
`ns/` JSON-LD namespaces). It is published as the Cloudflare Pages project
**`yurucommu-website`** and served at **https://yurucommu.com**.

There is no build step — the directory is uploaded as-is. `_headers` sets the
`application/ld+json` content type (and CORS) on the `/ns/*` JSON-LD contexts so
strict JSON-LD processors accept them.

## Deploy a new version

```sh
# from the repo root
bunx wrangler pages deploy site --project-name=yurucommu-website --branch=main
```

This uploads `site/` and returns a `*.yurucommu-website.pages.dev` preview URL;
the production alias (`yurucommu-website.pages.dev` and the custom domain) update
automatically.

## Custom domain (one-time)

The custom domain is attached to the Pages project:

```sh
# requires a token with Pages:Edit (already added once)
# POST /accounts/<acct>/pages/projects/yurucommu-website/domains  {"name":"yurucommu.com"}
```

It stays **pending** until a DNS record points the apex at the project. In the
`yurucommu.com` zone (same Cloudflare account) add a **proxied** record:

```
CNAME  yurucommu.com  ->  yurucommu-website.pages.dev   (Proxied / orange cloud)
```

Cloudflare flattens the apex CNAME automatically. Once the record exists the
Pages domain validates over HTTP and goes **active** (TLS via Google CA). Add
`www.yurucommu.com` the same way if a `www` alias is wanted.
