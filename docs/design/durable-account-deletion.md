# Durable local account deletion

Core reserves the exact signing-key incarnations of a local account and its
owned personas before teardown. This is a shared lifecycle guarantee, not a
single-owner registration policy. Yurucommu opts into its own single-owner
composition; generic Core and Yurumeet retain their principal semantics.

Migration `0031_account_deletion_reservations.sql` adds the operation, target,
authored-object snapshot, atomic assertion and upload-attempt tables and write
fences. It does not rebuild or discard existing product tables. Both product
consumers must apply the owning migration before serving the updated engine.

## Reservation and retry

The durable operation records the root signing key, all live owned personas,
and one stable outbound Delete intent per target. A child deleting itself
reserves only that child. Target discovery uses one set-based atomic batch,
including legacy families larger than the current persona-creation limit.

The renewable two-minute lease authorizes one worker. Expiry transfers execution
with a compare-and-swap; it never removes the reservation or permits login,
revival, persona creation, or ordinary writes. Every destructive database batch
asserts the current token, lease and signing-key incarnation atomically with its
payload. Authenticated requests admitted before reservation must recheck their
identity and reservation at write time. Raw driver/prepared-write escapes on
that request facade fail closed.

Trusted lifecycle SQL uses a lazy driver-prepared batch item. Drizzle 0.45.2's
raw `db.run(SQL)` batch item lacks the prepared statement required by native
D1 for bound parameters; libsql/proxy tests alone do not expose that difference.
The engine helper retains the driver's raw result mapping and constructs no
SQL effect before batch execution. It requires the owning unguarded session,
which a request facade refuses to expose. Lifecycle items are still submitted
through the token-guarded batch. Requalify this pinned internal ORM contract
when upgrading Drizzle.

Failures preserve the operation and targets. All actors stay live and original
sessions remain deletion-only retry authority until every cascade completes.
The final atomic batch tombstones all targets, removes their sessions and then
releases the plan. Retention resumes up to two expired operations per pass even
after login sessions expire. Storage keys are snapshotted before external delete,
and acknowledgment removes only the matching ID/key rows. A stale worker cannot
acknowledge a successor's work.

## Upload coordination

An upload commits an immutable uploader/signing-key/blob-key attempt in phase
`putting` before calling ObjectStore.put. New attempts are refused once the
actor or its owner is reserved. After the put promise settles successfully,
metadata adoption and attempt removal happen in one guarded atomic batch. An
admission or database failure rolls back that adoption.

After any settled put failure, including a provider rejection that may already
have written bytes, a narrow request cleanup capability changes only that exact
attempt to `cleanup`. Object-store deletion must succeed before its row can be
acknowledged. A failed storage delete or acknowledgment retains the key for
retry. Retention drains up to 50 cleanup attempts, and account deletion also
reconciles attempts for every target, including already-completed cascades.
Any remaining attempt blocks final tombstoning and plan release.

**Recovery limit:** A process may disappear after persisting `putting`, or after
put settlement without persisting its transition. ObjectStore has no external
write fence or cancellation guarantee. Neither attempt age nor deletion-lease
expiry proves that a delayed put cannot still land. Core therefore never expires
or deletes a putting attempt, and does not report completed account erasure in
that state. Automatic abandoned-operation recovery covers retryable cascades
and settled cleanup, not an unknown external-write outcome.

Such a row needs an operator/provider reconciliation contract: retain its exact
attempt/key/actor identity, establish that every writer capable of putting that
key has terminated or that storage fences it, then durably mark settlement and
retry deletion. A timestamp or one successful blob delete is insufficient proof.
This source change provides no public mutation endpoint or automatic override
for that operation. Operator authorization, backup/restore evidence, and proof
of write quiescence remain separate requirements.

## Evidence boundary

Portable SQLite tests establish local ordering and rollback; native D1 tests
must separately qualify trigger behavior, batch atomicity, affected-row metadata
and migration preservation. Synthetic storage failure/timing tests do not prove
a real provider's put/deletion behavior. Existing operator data update/restore,
published-package adoption and public issuer/runtime qualification are separate.

SQL cannot retract an already signed or in-flight ActivityPub Delete. Immediate
reuse of the same AP ID requires an explicit federation identity/quiescence
policy; a local operation lease does not prove remote non-reuse safety.
