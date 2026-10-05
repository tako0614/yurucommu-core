# Historical notification push schema repair

The published Core 3.2.0 version of migration 0019 declared actor foreign keys
with `ON DELETE CASCADE` on `notification_pushers` and `notification_push_jobs`.
Current 0019 and the runtime schema deliberately have no actor foreign key:
remote or otherwise absent recipients must not cause the unread-inbox job
trigger to abort unrelated inbox writes. An applied filename is the migration
identity. Therefore changing the same-named SQL did not fix databases which
already applied the historical file.

Migration 0036 is the forward repair. Previous SQL and ledger rows are not
rewritten. Both historical and current 0019 already enforce global uniqueness
on `(product, app_id, pushkey_hash)`; the old actor-scoped index is redundant.
The repair preserves the global index and removes the actor foreign keys and
redundant index. It does not select a new device owner or deduplicate records.

## Preserved state and behavior

Both push tables are copied to no-FK shadow tables with every column explicitly
selected and no row filter, replacement, ignore or state normalization. Opaque
pushkeys, metadata, identifiers, nullable values and timestamps survive. Job
status, processing token, attempt count, pending pusher IDs, next retry, error
and delivered time are copied exactly, including processing, terminal or unknown
states. No queue draining or destructive cleanup is part of this migration.

All current indexes are recreated. The unread-inbox trigger still creates one
deterministic pending job and read inbox entries create none. Inbox deletion
still removes only `pending`, `queued` and `retry_wait` jobs, retaining processing
and terminal jobs. The three account-deletion guards from 0031 are restored:
pusher insertion, pusher update across either actor, and job insertion must
respect deletion reservations unless the matching write assertion is present.
Existing explicit application cleanup remains responsible for actor teardown.

The inbox-owned triggers are removed before rebuilding either table so SQLite
schema validation during rename cannot resolve a dangling jobs-table reference.
Table-owned deletion guards are automatically removed by DROP and are recreated
before commit. The shipped schema has no inbound foreign keys to either push
table; the repair drops child tables and never drops an actor or inbox table.
`PRAGMA foreign_keys = OFF` is not a repair mechanism on D1. Deferring validation
also does not prevent foreign-key cascade actions.

## Activation and failure handling

Close all application/inbox/registration/job writers, account-deletion writers,
queue consumers and scheduled push jobs for the whole snapshot/apply/reopen
window. The migration has no runtime maintenance lock and cannot establish
operator writer quiescence on its own. Preserve a closed pre-apply snapshot of
all durable state using the owning product's recovery procedure.

Inspect the exact target ledger and physical schema before application. An old
Wrangler installation may use `d1_migrations`, while the Core helper and current
products use `yurucommu_migrations`. Do not invent ledger rows or reconcile the
stale live `_cf_migrations` ledger by running automatic migration commands.
Verify canonical table columns, global device/job unique indexes, the five
current triggers, and absence of incoming foreign keys/custom state-bearing
triggers/views referencing either table. An unknown partial or customized
schema requires a separately reviewed forward repair. An index conflict or
invalid row is a diagnostic, not authority to delete/deduplicate data.

The SQL guard compares the exact SQLite CREATE declarations of both supported
old/current table shapes and current indexes/guards. It also refuses extra columns,
generated columns, customized types/defaults/constraints, custom indexes or
triggers, views referencing the tables, and incoming foreign keys before DROP.
Even harmless reformatted/customized CREATE declarations fail closed; diagnose
and review that target rather than loosening the guard or deleting rows.
Incoming-FK inspection visits only table declarations containing either target
identifier. Unrelated D1 internals such as `_cf_METADATA` reject foreign-key
introspection with `SQLITE_AUTH`; skipping unrelated declarations avoids that
runtime restriction without skipping an operator table by its name prefix.

The SQL executor must apply a complete migration file **and its ledger mark**
as a single atomic transaction. The local server uses its SQLite driver's
transaction wrapper. The activation helper passes one SQL script containing
both. With transaction wrapping disabled for D1, the configured executor must
provide the atomic boundary: the products' Wrangler file path imports one file,
and local Wrangler uses its SQL splitter and one D1 `batch`. A generic executor
must offer equivalent all-or-nothing semantics; sending independently committed
statements is unsupported. Do not add explicit BEGIN/COMMIT to D1 SQL.

The helper attempts migration execution once, in either per-file or grouped
mode. Ledger initialization/read retain bounded transient retries. A timeout or
lost acknowledgement may follow a successful schema+ledger commit; blindly
replaying SQL can rebuild an already-applied schema or encounter a duplicate
ledger insert. Surface the first migration failure. A new activation rereads
the ledger. Before retrying/reopening after uncertain outcome, inspect the
actual schema, indexes, guards, row state and ledger: either the original state
must be intact or the complete repaired state and mark must be present. Partial
state indicates a non-atomic executor or divergent target and requires forward
repair while writers stay closed.

Code rollback does not undo this schema transition. Old FK assumptions must not
be recreated over newer data. Recovery requires a qualified closed snapshot
restoration or an explicitly reviewed forward repair of all related state;
never restore one database while external writers continue against it.

## Evidence boundaries

Tests compare the exact archived Core 3.2.0 0019 fixture (SHA256
`d25c15525b140a220769592f713901befe9f6f2589f35fe7fd9937476fbb6077`) and
current schema. They must prove all-column preservation, indexes and all five
trigger behaviors. Disposable native D1 with the pinned Wrangler SQL splitter
must also prove late DDL/index/trigger/ledger failures roll back the entire
invocation, and that a clean retry/read-ledger skip works. A command-boundary
response-loss fixture verifies the activation helper stops replay.

Local libsql or disposable workerd/D1 results do not establish a remote import's
rollback, an actual deployment's schema/ledger, existing operator-data recovery,
real gateway delivery, or GA readiness. Product package adoption and populated
published-artifact update/restore are separate qualifications. Real-data/live
migration is performed only by the owning product's authorized deploy path,
with exact environment and private target/pre-apply/recovery evidence.
