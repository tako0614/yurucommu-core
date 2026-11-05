# Terminal inbound object deletion

A verified remote Delete is terminal for its actor and exact object IRI.
An older Create delivered later must not restore the deleted content. Another
actor on the same host does not inherit that deletion intent or its authority.

## Durable evidence

Migration 0038 adds `inbound_object_deletions`, keyed by canonical actor IRI and
exact object IRI. Actor normalization is the same deliberately narrow comparison
used by the HTTP-signature boundary. Object path, query and fragment bytes are
not normalized into another object identity. The optional Activity id records
the original dispatch provenance; it is not the lifetime owner of the receipt.

`handleDelete` receives the verified actor from the existing inbox pipeline.
Before reading the target object, it stores the idempotent receipt only for a
safe, bounded, nonlocal object IRI on that actor's origin. This states the
signer's intent; it does not claim ownership of an object retained for another
actor. The original retained-author and source checks still control cleanup.
Existing owned legacy objects with an invalid/local IRI can still be cleaned
up, but such an IRI cannot mint a new remote reservation. Self-Delete(Actor)
keeps its separate actor tombstone contract.

The actor/group inbox previously ignored Delete. It now dispatches to the same
existing handler without changing signature verification, claims, deduplication
or completion. This covers a room message's actual delivery endpoint too.

## Concurrent materialization

Every remote object materializer checks the receipt in the same atomic batch
as its object/projection write: direct and generic Note Create, Story Create,
actor-inbox group messages, and fetched Announce targets. A pre-read alone is
insufficient. If the receipt wins, the Create batch cannot expose an object or
recipient. If Create wins first, Delete's subsequent object read finds and
cleans up that object. Later notification writes are subject to the same fence.

Receipt admission failure is a completed no-effect rejection for Create:
the inbox returns 202 and commits its dispatch rather than returning 503
forever. A fetched Announce target returns false. Genuine SQL or cleanup faults
still propagate through their existing retryable paths. A failed cleanup can
leave a retained object pending its normal retry, while the receipt continues
to prohibit new materialization. An Update of an already retained object does
not remove the receipt or revive an absent object.

## Retention and compatibility

Receipts have no actor, object or Activity foreign key and no automatic expiry.
Cache/Activity retention, account teardown and object cleanup must not restore
permission to create an identity whose deletion was already accepted. This
does not create a provisional `objects` row or infer its author. Historical
`activities.processed = 1` can represent a no-op or unsupported type, so neither
those rows nor plausible raw JSON are automatically converted into receipts.
Deletions accepted by older engines remain an explicit reconciliation gap.

The migration is additive and preserves protected existing schema/data. Apply
the complete file before starting the new engine, with earlier writers closed.
No backfill or destructive rebuild is needed. Before any new receipt has been
accepted, the added table is inert for the old engine. After acceptance, rolling
runtime back to an engine that ignores receipts can resurrect content; retain
the table and repair forward, or quiesce federation until a compatible engine
is available. Restoring a database from before accepted Deletes also loses
their terminal evidence and requires an explicit reconciliation plan.

## Verification boundary

The owning tests use actual signed user/shared/actor inbox requests and real
SQL under the portable D1-semantics fixture. They cover delivery after Delete,
Activity retention cleanup, both concurrent receipt/Create windows, canonical
actor aliases, exact object ids, invalid reservation targets and same-host
actor separation. Story and Announce materialization use the existing fetched
document fixture; its network seam is synthetic, not live federation evidence.
The additive migration rehearsal preserves representative old private data,
checks unchanged old schema and verifies receipt survival without foreign keys.

This contract establishes terminal Delete precedence, not a total order for
multiple Updates. Update-before-Create and peer revision/causal ordering remain
separate work. Actual D1, deployed engines, installed apps and remote federation
delivery require their own authorized qualification; source/local success does
not establish them.
