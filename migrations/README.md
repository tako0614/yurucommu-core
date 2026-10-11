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

Migration0035 adds permanent published-media deletion claims, keeping metadata
until complete reference proof and preserving unsupported legacy identities.
Apply with writers closed; no existing upload/job is automatically claimed.
See [published media deletion](../docs/design/published-media-deletion.md) for
account ordering, retry, legacy reconciliation and closed-restore limitations.

Migration 0034 adds new-upload staged lifetimes, atomic reference fences and a
bounded, resumable reference backfill. It preserves legacy upload rows and
unknown external puts. Apply it before serving the engine; collection stays
closed until all reference cursors complete and preserved ambiguity is resolved.
See [staged media retention](../docs/design/staged-media-retention.md) for
consumer deadlines, activation, forward repair and qualification limits.

Migration 0033 makes endpoint reconciliation generations and repair intents
durable without rebuilding tables. Legacy jobs retain their current series but
receive no inferred additional reconciliation budget. Apply it with delivery
writers/consumers closed before serving its engine. See [durable delivery
reconciliation](../docs/design/delivery-reconciliation.md) for the conservative
legacy policy, notification-loss recovery and rollback limitations.

Migration 0032 adds atomic public-outbox revocation for deleted-object Activity
history without rebuilding tables or rewriting ledger rows. Apply it before
serving its engine. It cannot classify pre-existing absent targets; exact
operator-data audit/adjudication and rollback limits are documented in
[public outbox reads](../docs/design/activitypub-outbox.md).


Migration 0031 adds durable account-deletion reservations and upload-attempt
coordination without rebuilding existing tables. Its runtime and recovery
limits are documented in [durable account deletion](../docs/design/durable-account-deletion.md).
Apply it before serving the corresponding engine. A retained `putting` upload
must not be removed by time-based cleanup or by a database restore shortcut.

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
   this API, so the Takosumi lifecycle-action path disables transaction wrappers while
   keeping the local/libSQL path wrapped by default.

4. **Post-apply activation**:

   In the OpenTofu-managed Worker path, the operator stores a versioned
   `post_apply` lifecycle action in Takosumi's service-side InstallConfig. It
   runs `bun run takosumi:release -- --migrations-only` as an opaque runner
   command; no OpenTofu Output declares or selects it.
   It reads non-secret outputs from `TAKOSUMI_OUTPUTS_JSON`, writes a temporary
   Wrangler config, and applies these core migrations through
   `wrangler d1 execute` without explicit SQL transaction wrappers. Provider
   credentials come from the same reviewed Provider Connection used by the
   OpenTofu run.

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
Takosumi-managed path invokes product-owned service-side lifecycle actions and
records activation status/logs; it does not expose a Takosumi DB
migration API. A future core migration may add `checksum TEXT` and store
`sha256:<hex>` per applied migration, but that requires coordination with
production data in both yurucommu and Yurumeet installations.

For restore / disaster-recovery procedures, see the operator runbooks under
[`takosumi/docs/operations/`](../../takosumi/docs/operations/).
