# yurucommu migrations

SQL migrations for the yurucommu social engine. Deployable product repos
(`yurucommu` and `yurumeet`) apply these migrations from the published
`@takosjp/yurucommu-core` package.

- **Substrate**: libSQL (single-host) or Cloudflare D1 (managed edge).
- **Ledger table**: `yurucommu_migrations(name TEXT PRIMARY KEY, applied_at)`.
  This is yurucommu-owned product state; it does **not** carry a checksum
  column.
- **Runner sources**:
  - `bun run app:activate` in this package for direct migration helper tests
  - `bun run takosumi:release` in a deployable product repo for Takosumi
    activation
  - `wrangler d1 migrations apply` for operator-managed Cloudflare D1 paths

## Naming convention

Files use a zero-padded 4-digit prefix:

```
NNNN_short_description.sql
```

Order is determined by lexicographic sort on the prefix. The runner records the
file name (not the numeric version) in `yurucommu_migrations`.

## Operator runbook

1. **Apply** (libSQL / single-host):

   ```bash
   cd yurucommu
   bun run start
   ```

   Migrations run lazily on the first DB connect.

2. **Apply** (Cloudflare D1):

   ```bash
   cd yurucommu
   npx wrangler d1 migrations apply <DB-NAME> --env <env>
   ```

3. **Apply migrations only** (Takosumi-compatible helper):

   `bun run app:activate` is the core package migration helper. Takosumi does
   not parse migrations, talk to the database, or provide a DB-specific API for
   this path; it only records the activation result when a product repo invokes
   the helper through its release hook. The operator activation environment must
   provide the SQL execution command.

   Prefix mode appends `<resource> <sql>`:

   ```bash
   YURUCOMMU_SQL_COMMAND_JSON='["operator-sql-cli","query"]' \
   YURUCOMMU_SQL_RESOURCE=database \
   bun run app:activate
   ```

   Template mode substitutes `{resource}` and `{sql}`:

   ```bash
   YURUCOMMU_SQL_COMMAND_TEMPLATE_JSON='["bunx","wrangler","d1","execute","{resource}","--remote","--json","--command={sql}"]' \
   YURUCOMMU_SQL_WRAP_TRANSACTIONS=false \
   YURUCOMMU_SQL_RESOURCE=DB \
   bun run app:activate
   ```

   Remote Cloudflare D1 rejects explicit `BEGIN` / `SAVEPOINT` statements through
   this API, so the Takosumi release path disables transaction wrappers while
   keeping the local/libSQL path wrapped by default.

4. **Post-apply activation**:

   In the OpenTofu-managed Worker path, the product repo's
   `takosumi_release.post_apply` runs
   `bun run takosumi:release -- --migrations-only` as an opaque runner command.
   It reads non-secret outputs from `TAKOSUMI_OUTPUTS_JSON`, writes a temporary
   Wrangler config, and applies these core migrations through
   `wrangler d1 execute` without explicit SQL transaction wrappers. Provider
   credentials come from the same reviewed Provider Connection used by the
   OpenTofu run.

   In the fallback path where the Worker script is not managed by OpenTofu,
   `takosumi_release.post_apply` runs `bun run takosumi:release` as an opaque
   operator release command. It reads non-secret outputs from `TAKOSUMI_OUTPUTS_JSON`,
   writes a temporary Wrangler config, runs `bun install --frozen-lockfile`,
   runs `bun run build:takos-worker`, applies D1 migrations through
   `wrangler d1 execute` without explicit SQL transaction wrappers, and deploys
   with `wrangler deploy`.
   Provider credentials and app-specific secrets come from the selected
   operator release activator boundary through
   `TAKOSUMI_RELEASE_COMMAND_ENV_ALLOWLIST`.

   Common operator env names:

   ```bash
   YURUCOMMU_ENCRYPTION_KEY=...
   YURUCOMMU_AUTH_PASSWORD_HASH=...
   TAKOSUMI_ACCOUNTS_ISSUER_URL=https://app.takosumi.com
   TAKOSUMI_ACCOUNTS_CLIENT_ID=...
   ```

5. **Forensics**:

   ```sql
   SELECT name, applied_at FROM yurucommu_migrations ORDER BY applied_at;
   ```

## Product-local ledger note

The `yurucommu_migrations` ledger is yurucommu-family product state. The
Takosumi-managed path invokes product-owned `takosumi_release.post_apply`
commands and records activation status/logs; it does not expose a Takosumi DB
migration API. A future core migration may add `checksum TEXT` and store
`sha256:<hex>` per applied migration, but that requires coordination with
production data in both yurucommu and Yurumeet installations.

For restore / disaster-recovery procedures, see the operator runbooks under
[`takosumi/docs/operations/`](../../takosumi/docs/operations/).
