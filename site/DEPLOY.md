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

## Custom domain (already configured)

`yurucommu.com` is attached to the Pages project and live (TLS via Google CA).
The apex resolves through a **proxied** CNAME in the `yurucommu.com` zone:

```
CNAME  yurucommu.com (@)  ->  yurucommu-website.pages.dev   (Proxied / orange cloud)
```

Cloudflare flattens the apex CNAME automatically. To re-create it if ever
removed: DNS → Add record → CNAME, name `@`, target `yurucommu-website.pages.dev`,
Proxied. Add `www.yurucommu.com` the same way for a `www` alias.

(The Pages domain was attached via
`POST /accounts/<acct>/pages/projects/yurucommu-website/domains {"name":"yurucommu.com"}`
— a token with Pages:Edit; the apex DNS record needs DNS:Edit or the dashboard.)
