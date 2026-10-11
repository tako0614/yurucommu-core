# Published media deletion

Migration0035 gives supported uploaded media a permanent physical-key deletion
claim independent of0034's never-published staged expiry. No legacy upload or
existing pending job is automatically claimed by migration application.

## Atomic claim and source ordering

Every object attachment and profile/community reference is journaled by0034 in
the same source statement. Source-specific owning object/profile mutations
record pending deletion intent while retaining upload metadata. Arbitrary
journal removal never grants intent for another uploader's media. This intent
is not physical deletion authority:
a same-key source update can remove/reinsert its journal entries freely. The
claim happens only after the complete desired source write, never from a
last-reference trigger. A current reference, including a foreign or alternate
URL reference, preserves metadata and bytes.

Runtime claims one selected bounded page through INSERT SELECT. Its view and
BEFORE INSERT trigger require the exact pending key/uploader and matching upload
identity when metadata exists; complete backfill; no NULL source IDs, global
legacy ambiguity, current journal reference or unresolved upload attempt; and
a supported uploads/<64 lowercase hex>.<jpg|png|gif|webp|mp4|webm> identity.
The same SQL operation removes exact upload metadata. The durable job already
exists before the claim. The permanent claim fences source-journal insertion,
upload metadata recreation/identity changes and new external put attempts.
Metadata absence in an older job is not a reference proof; the complete journal
and exact supported job identity remain necessary. No content metadata is
reconstructed from such a job.

The normal pre0035 producers selected the upload belonging to the deleted
object's author, or atomically claimed an exact never-published0034 lifetime.
The job schema does not record producer provenance. Source inspection therefore
cannot authenticate a manually inserted or corrupted historical job; verify
unusual existing rows against operator evidence before enabling automatic drain.

Reference-first serialization produces no claim and no external deletion.
Claim-first serialization rejects a later source write with409 MEDIA_EXPIRED,
including while the provider deletion is awaited and after job acknowledgment.
New source writes with an unsafe normalization envelope still receive400
MEDIA_REFERENCE_INVALID. Claims remain permanently after successful deletion;
provider failure, partial deletion, process loss or acknowledgment failure retain
the job and immutable claim for idempotent retry. Never-published0034 deleting
lifetimes remain independently sufficient permanent authority.

Canonical post deletes commit pending intent with their complete object mutation.
Legacy DM/community/Story/inbound/moderation cascades retain metadata while their
caller removes the source. Owning object triggers also inspect bounded decoded
OLD attachment values for exact upload key or local /media filename, independent
of backfill progress. Objects belonging to another uploader grant no intent.
Profile triggers require the OLD actor to own the exact local upload and an
actually changed slot. A same-key desired update remains referenced and cannot
be claimed. Noncanonical/absolute historical references remain conservative
liveness evidence; their automatic source-trigger intent is not guaranteed.

Community replacement co-commits intent with the source update only if the
authorized setter owns the actual OLD local upload and changes its URL. The
schema has no historical icon-setter provenance: another manager's upload is
preserved for uploader reconciliation, not deleted using current membership.
All replacement drains are trailing best-effort work. Missing MEDIA leaves
durable intent unacknowledged; metadata can only be removed by a claim, never by
the missing binding itself. Retention pages at
most50 due keys and reschedules selected work before an external attempt.

## Account deletion and protected legacy data

Account teardown removes authored sources and clears its own profile image
references under the existing reservation/lease guard before claiming uploads.
It clears the icon of a community it retires; a surviving/transferred community
or foreign source is not silently revoked. Such a reference preserves metadata,
bytes and the durable account retry reservation until separately authorized
repair/rehome. Cascade completion and target release both require no retained
upload or physical deletion job. Missing storage/provider failure never reports
completed erasure. A claim for a reserved actor requires the exact operation's
atomic writer assertion; an ordinary retention worker cannot bypass that guard.
Completed targets from an older engine are reconciled again under their
operation guard, including jobs whose upload metadata is already absent, before
the final actor/session batch releases reservations.

The account purge preserves its selected identity snapshot across external
waits. It currently materializes that actor's upload and pending-job keys, then
claims in SQL pages of at most90 keys, deletes provider pages of at most1000,
and acknowledges SQL pages of at most90. The retention50-row drain limit does
not bound the whole account snapshot; production scale/memory remains a
separate qualification requirement.

Noncanonical historical media keys are outside0034's complete reference index.
They remain with metadata/blob/pending intent for explicit reconciliation or a
future qualified bounded exact-key index. Unknown putting attempts never expire
and cannot be claimed. This conservative policy may block account completion;
it is a visible recovery dependency, not successful automatic erasure.

Apply0035 before enabling the corresponding engine with source and cleanup
writers closed. Verify the reference backfill/ambiguity state and pending jobs
before enabling automatic claim/drain. Older writers do not honor the permanent
fence; do not downgrade by deleting claims or restoring metadata alone. Recovery
requires closed writers and a consistent DB/provider restore retaining claims,
pending jobs and unresolved attempts, or separately qualified forward repair.

Portable and disposable D1/workerd tests must separately establish ordering,
rollback, trigger/batch behavior, global blockers and provider failure/retry.
They do not prove real provider deletion, operator-data update/restore, live
Cron/federation, public-host readiness or full product GA. Generic Core and
Yurumeet principal semantics stay unchanged; Yurucommu single-owner remains its
product composition. Core/API publication and each consumer's schema/pin/UX
adoption are separate dependencies.
