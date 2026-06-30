# yurucommu migrations

SQL migrations applied to yurucommu's chat / activity database (libSQL or
Cloudflare D1, depending on deployment).

- **Substrate**: libSQL (single-host) or Cloudflare D1 (managed edge).
- **Ledger table**: `yurucommu_migrations(name TEXT PRIMARY KEY, applied_at)`.
  This is yurucommu-owned product state; it does **not** carry a checksum
  column.
- **Runner sources**:
  - `yurucommu/src/backend/server.ts` (Bun/libSQL local path)
  - `bun run app:activate` (product-local migration helper; requires
    operator-provided SQL command env)
  - `bun run takosumi:release` (Takosumi/Takos-managed activation path; renders
    temporary Wrangler config from `TAKOSUMI_OUTPUTS_JSON`, runs the migration
    helper, and deploys the Worker)
  - `wrangler d1 migrations apply` (operator-managed Cloudflare D1 path)

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

   `takosumi_release.post_apply` runs `bun run app:activate` as an opaque
   command. Takosumi does not parse migrations, talk to the database, or provide
   a DB-specific API for this path; it only records the activation result. The
   operator activation environment must provide the SQL execution command.

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

4. **Publish Worker** (Takosumi post-apply activation):

   `takosumi_release.post_apply` runs `bun run takosumi:release` as an opaque
   runner command. It reads non-secret outputs from `TAKOSUMI_OUTPUTS_JSON`,
   writes a temporary Wrangler config, runs `bun install --frozen-lockfile`,
   runs `bun run build`, applies D1 migrations through `wrangler d1 execute`,
   without explicit SQL transaction wrappers, and deploys with `wrangler deploy`.
   Provider credentials are supplied by Takosumi's runner sandbox from the
   selected ProviderConnection. App-specific secrets can come from the selected
   release execution boundary; an operator activator may provide them through
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

The `yurucommu_migrations` ledger is Yurucommu-owned product state. The
Takosumi/Takos-managed path invokes `bun run app:activate` through the generic
`takosumi_release.post_apply` command and records activation status/logs; it
does not expose a Takosumi DB migration API. A future Yurucommu migration may
add `checksum TEXT` and store `sha256:<hex>` per applied migration, but that is
Yurucommu product work and requires coordination with production data.

For restore / disaster-recovery procedures, see the operator runbooks under
[`takosumi/docs/operations/`](../../takosumi/docs/operations/).
