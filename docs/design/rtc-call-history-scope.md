# RTC call history ownership and transition

Call identifiers are scoped to their local actor. Migration 0041 adds
`actor_call_sessions` with primary key `(local_actor_ap_id, id)` and retains
the applied `call_sessions` table, its rows, indexes and deletion guards.
No existing table is rebuilt, dropped, renamed or globally backfilled.

## Reads and writes

The call store reads the owner's scoped rows plus their legacy rows that have
no scoped successor. A single indexed UNION ALL selection prevents duplicate
IDs without copying data on GET. List results retain the existing descending
creation order and 1–200 output limit; another owner's rows never participate.

The next normal lifecycle write inserts one scoped row. Its original peer,
direction, media, creation time and end reason come from the same owner's
legacy row when present; lifecycle state and connection/end times come from
the current transition. This selection and upsert are one SQL statement.
Legacy data is not modified. Later writes conflict only on that owner's ID.
Another actor's identical ID cannot import or overwrite the retained row.

The logical Drizzle `callSessions` export now addresses scoped history;
`legacyCallSessions` addresses the preserved old physical table. API and wire
IDs remain unchanged. Remote peers do not acquire a local-actor foreign key.
The local owner FK, deletion reservations and operation-marker exceptions
are preserved. Account teardown removes local-owner and peer rows from both
tables before committing the actor tombstone.

## Activation, interruption and reversal

All installed customer/operator data is protected. Apply additive 0041 through
the owning product's migration path before serving this engine. Close old
writers and call consumers at the switch; they still have the old global-ID
collision and do not see new scoped state. Before enabling the new engine,
read back the table/compound key, indexes, FK, all three deletion guards and
the product migration ledger. Apply failure must leave the new engine closed;
repair forward through the same product path, never by deleting old data.

Before any scoped write, the old runtime and its preserved history remain
usable with their known collision defect. After a scoped write, rolling back
to a legacy-only engine would hide accepted history and newer lifecycle
states. Preserve both tables and repair forward; do not merge by global ID,
reconstruct unknown lost rows, or silently discard scoped history. No automatic
contract/drop phase is introduced. Migration retry uses the existing idempotent
creation statements; target schema and ledger integrity still require readback.

Local fixtures cover the empty/fresh lineage and preserved 0040 history,
tenant isolation, lifecycle retries and account deletion. They do not qualify
an installed migration, real D1/DO scheduling, live peer/media, package adoption
or deployment. No production-shaped target is inferred from a local success.
