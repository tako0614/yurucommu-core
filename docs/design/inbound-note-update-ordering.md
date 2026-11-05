# Admitted inbound Note Updates

A verified Note Update can arrive before its original Create or be retried
after a later edit. Dispatch completion alone does not mean its mutation was
applied. Preserve admitted changes, apply them in local admission order, and
expose only the final authorized projection.

## Admission and durable order

Migration 0039 adds an event receipt and an actor/object applied head. Each new
event has one stable internal Activity identity, a canonical verified actor,
an exact object IRI, a monotonic local sequence and a bounded normalized patch.
The normal inbox continues to verify signatures, bind signer/actor, enforce
domain limits and own dispatch claims. The patch is admitted only by the Note
handler after shape and suppression checks. Unknown objects require the same
safe nonlocal actor-origin identity as Create. Known owned legacy objects keep
their existing update path. Actor documents and Stories keep their separate
handlers; Story-shaped Notes are not reinterpreted as ordinary Note patches.

An event retry cannot replace its original patch or obtain a later sequence.
Partial fields preserve absence versus explicit empty/null clearing. A reach
update replaces all four to/cc/bto/bcc fields together; content-only edits keep
current reach. Neither peer timestamps nor Activity-id lexical order supplies
local order. The sequence is minted at durable admission, not network arrival,
and does not prove the remote author's true causal order.

There are at most 16 unapplied events for one actor/object. New input over that
bound is retryable and unacknowledged; duplicate receipts remain retryable
without consuming capacity. Applying a window releases its capacity. Existing
inbox payload, address, identity and per-domain admission limits still apply.
This queue does not replace those deployment resource limits.

## Planning and first exposure

Create, Update, group Create and Announce materialization read the current
projection, head and bounded pending window. Each patch is checked again
against current author/type/deletion, owner suppression, parent readability,
community membership/ban and room authority. A current policy rejection is a
no-effect event, so it cannot permanently block a valid Create or later edit.
Database failures and corrupt admitted state remain retryable; they are not
converted into successful no-ops.

The folded body, visible addressing, indexed hidden recipients, conversation,
tags and reply/community projection are committed together. The same batch
advances the applied head and reclaims only that bounded window's patch
payloads. Permanent identity/sequence receipts remain, so retention of the
Activity ledger cannot make an old Update a new edit. Admission asserts the
head, newest event, complete source projection and indexed recipient set in
the actual transaction. An interleaved newer event or changed source prevents
stale first exposure and leaves the request retryable.

The body/reach update, local post counter transition and exact old/new parent
counts share the batch. Existing recipient rows retain their creation times
when membership remains unchanged. A late Create uses the retained current
projection; its old addressing cannot restore a recipient revoked by Update.
The first direct materialization indexes the complete signed recipient set,
including hidden recipients, before local fan-out. Each routed recipient can
then read that current projection without using an old Create to restore reach.

New object creation also records its actual Create dispatch identity in the
head. Notifications are generated from the folded reach/tags/parent, under the
committed projection guard. The same Create can repair a genuine later
notification failure without guessing historical creator provenance or
duplicating the object. A direct delivery not addressed by the folded reach
does not notify its old recipient. This does not introduce delivery to new
remote recipients or a new notification fanout service.

That creator identity belongs to the physical materialization. If the Note
is subsequently removed, retrying its original Create cannot resurrect it.
A genuinely new Create can materialize a new generation and records its own
notification-recovery identity; an unsigned fetch records no Create identity.

## Group and Announce adapters

The actor inbox now dispatches Note Update as well as Create/Delete. A group
projection uses its retained one-room audience and rechecks that community's
current post policy, membership and ban. Content/summary/attachments/tags may
change, but an Update cannot move the room/thread, widen reach or convert
`visibility=group`, `communityApId=NULL` and the audience recipient into a
public/feed/DM shape. The group adapter can repair its canonical audience link.

The shared posting decision can retain an ephemeral witness of its actual
community policy, accepted Follow or local membership/role. The projection
batch and subsequent notification guard recheck those exact current rows and
canonical-actor bans. A revocation between planning and commit rolls back the
projection and leaves the event retryable. Witnesses from accepted patches
are deduplicated per room and passed as one bounded JSON parameter, including
when all sixteen pending patches select different communities. They are not
stored in admitted patches and cannot replace actual database authority.
New Note reply admissions retain the actual successful canonical parent read.
The child batch checks the exact parent read projection, operator block
absence, community resolution (including previously unknown audience IDs),
the selected membership/Follow/hidden-recipient grant and non-owner Story
expiry. A missing parent is admitted with an actual absence witness, so a
parent appearing before commit forces a fresh decision. Deleted parents are
rejected by Create as well as Update and fetched Note entrances.

The same canonical identity SQL rechecks the local parent's owner block/mute,
the routed Create recipient's suppression and the any-owner suppression check
used by accepted Note edits. A revocation after planning rolls back body,
reach, counters and the applied head; database errors remain retryable.
Partial edits retain the currently selected parent receipt, replace it when
selecting another parent and drop it on explicit clearing. Only the final
parent is witnessed, rather than accumulating sixteen large read guards.
The receipt uses one JSON parameter and fails without truncation when its
serialized bytes exceed the [D1 bound-string limit](https://developers.cloudflare.com/d1/platform/limits/).
These dependencies are ephemeral and are not minted from historical Activity
JSON or supplied as external authorization. Existing unrelated parent body or
counter edits do not invalidate a read grant. Other product writers and Story
creation are outside this Note-admission batch boundary.
Editing only the body of an existing reply does not select a new parent or
reauthorize its historical link; that existing edit contract is unchanged.

An Announce GET is an existence/creation baseline, not a signed instruction
revoking an already accepted private Update. Matching-author/exact-object
pending patches fold over that baseline in local admission order. The final
projection must still meet the existing Announce public/unlisted and current
community gates. Otherwise that adapter returns false, stores no object and
leaves the pending window unapplied for a legitimate Create entrance. An
actually newer remote GET body can conflict with an older signed patch; this
protocol carries no evidence to infer their true causal order, and this engine
does not manufacture it from HTTP/peer timestamps.

Terminal Delete receipts from 0038 still win. Update after a terminal receipt
is a completed rejection without a mutation; a late Create cannot publish the
pending body. Self-Delete(Actor), Story lifetime, dispatch leases and the hard
Activity/object cascade contracts remain separate.

## Compatibility and verification

The additive migration changes no existing object, recipient, Activity or
creator identity. Historical `processed=1` may mean unsupported/no-op dispatch,
so raw Activity history is not backfilled as admitted mutation authority.
Existing objects with unknown creator provenance retain that uncertainty.
Apply the complete migration before serving the engine, with older writers
closed. After new patches have been accepted, rolling back to an engine that
ignores them can lose acknowledged edits; retain this state and repair forward.
Restoring older data also requires explicit reconciliation of accepted patches.

Actual signed-route regressions cover both delivery orders, partial changes,
first-exposure privacy, stale retry after genuine SQL failure, interleaved
receipt/Create, terminal deletion and group policy. Component tests use the
owning D1-semantics database for atomicity, capacity and additive migration
retention. Fetch document tests keep their existing synthetic network seam.
Those are source/local proofs, not deployed D1, live federation, installed app,
OS or package-publication qualification. Older accepted Updates are not repaired
automatically and remote causal ordering remains unproven.
