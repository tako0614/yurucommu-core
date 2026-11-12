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

Migration 0041 adds owner-scoped RTC history while preserving the applied
history table and rows. Reads merge retained own rows; a lifecycle write
imports only its own legacy metadata in one statement. Apply before serving
the corresponding engine with old call writers/consumers closed. After new
history is accepted, a legacy-only engine is not a safe runtime rollback.
See [RTC history ownership](../docs/design/rtc-call-history-scope.md) for
deletion guards, activation readback, interruption and forward repair.

Migration 0040 adds bounded endpoint-invalidation continuation to retained
delivery jobs. Existing rows receive no inferred recovery authority or extra
HTTP/reconcile budget. Apply before serving its engine with old delivery
writers/consumers closed. Once pending recovery is accepted, an older engine
that ignores it is not a safe runtime rollback: preserve state and repair
forward. See [endpoint invalidation recovery](../docs/design/delivery-endpoint-recovery.md)
for conditional page writes, wakeup loss, retention and qualification limits.

Migration 0039 retains newly admitted Note Update patches in local admission
order, independently of Activity dispatch completion. Object/reach projection
and its applied watermark commit together; pending patches are folded before
Create first exposes content. Historical processed Activities are not imported.
Apply before serving the corresponding engine with old writers closed. Once
patches are accepted, an engine that ignores this state is not a safe rollback.
See [inbound Note update ordering](../docs/design/inbound-note-update-ordering.md)
for retention, partial updates, policy checks and qualification limits.

Migration 0038 adds actor-bound terminal inbound object deletion receipts.
It changes no existing data and infers no receipt from historical Activity rows.
Apply it before serving the corresponding engine, with old writers closed.
Once the new engine has accepted a terminal Delete, an older engine that ignores
the receipts is not a safe runtime rollback. Preserve receipts and repair forward.
See [inbound object deletion ordering](../docs/design/inbound-object-deletion-ordering.md)
for identity, concurrent delivery, retention and qualification limits.

Migration 0037 adds opt-in observed-message read receipts without modifying
existing messages or timestamp read rows. It does not opt in any account or
perform a global backfill. The serving engine must have the complete migration
before exposing the new endpoints. A first authenticated init atomically
preserves the conversation's legacy read set and enters exact mode; later ACKs
record only explicitly supplied readable IDs. Legacy mark-current endpoints
retain their existing weaker semantics. See [observed chat reads](../docs/design/talk-observed-read.md)
for membership epochs, compatibility, rollback and qualification limits.

The same additive file stores peer-specific archives and explicit expansion
markers for historical conversation-wide archives. Applying it changes no
archive state. A later authenticated archive/unarchive operation atomically
copies its currently indexed peers before selecting peer-specific state;
the original coarse row and its timestamp remain intact. GET never backfills.
New archive rows also retain the selected stored conversation ID as provenance.

Migration 0036 repairs notification push tables created by the published Core
3.2.0 version of 0019, whose actor foreign keys remain when a filename-only
ledger skips the current 0019. It also preserves fresh current installations.
It retains every registration/job state column, global device uniqueness, inbox
insert/delete triggers, and durable account-deletion guards. Apply with all writers and
push consumers closed, in one atomic file including its ledger mark; do not
split statements into independently committed requests. See
[historical push schema repair](../docs/design/historical-notification-push-schema.md)
for executor requirements, target preflight, failure handling and qualification.


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
