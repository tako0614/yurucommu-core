# yurucommu migrations

SQL migrations applied to yurucommu's chat / activity database (libSQL or
Cloudflare D1, depending on deployment).

- **Substrate**: libSQL (single-host) or Cloudflare D1 (managed edge).
- **Ledger table**: `_cf_migrations(name TEXT PRIMARY KEY, applied_at)`.
  This is the legacy wrangler-style ledger that yurucommu adopted before
  the ecosystem migration runner contract; it does **not** carry a
  checksum column.
- **Runner sources**:
  - `yurucommu/src/backend/runtime/compat/env.ts` (libSQL path)
  - `yurucommu/src/backend/runtime/compat-bun/env.ts` (Bun path)
  - `yurucommu/src/backend/server.ts` (D1 path)

## Naming convention

Files use a zero-padded 4-digit prefix:

```
NNNN_short_description.sql
```

Order is determined by lexicographic sort on the prefix. The runner
records the file name (not the numeric version) in `_cf_migrations`.

## Operator runbook

1. **Apply** (libSQL / single-host):

   ```bash
   cd yurucommu
   deno task start
   ```

   Migrations run lazily on the first DB connect.

2. **Apply** (Cloudflare D1):

   ```bash
   cd yurucommu
   npx wrangler d1 migrations apply <DB-NAME> --env <env>
   ```

3. **Forensics**:

   ```sql
   SELECT name, applied_at FROM _cf_migrations ORDER BY applied_at;
   ```

## Known drift from the canonical contract

The `_cf_migrations` ledger predates the contract in
[`docs/quality/migration-runner-contract.md`](../../docs/quality/migration-runner-contract.md).
A future migration should add `checksum TEXT` and store
`sha256:<hex>` per applied migration; the runner already has access to the
on-disk SQL so the change is mechanical, but requires coordination with
production data (existing rows have NULL checksums until backfilled).

For restore / disaster-recovery procedures, see
[`takos-private/docs/operations/`](../../takos-private/docs/operations/).
