# Observed chat read receipts

The additive 0037 schema and authenticated `/api/dm/{user|community}/{encodedApId}/read-observed`
contract separate a new client's displayed-message ACK from the legacy server-time
mark-current-conversation operation. This is a source/local transition; it does
not claim that an installed server, native device or real D1 has adopted it.

## Transition and authority

Before its first message GET, a participating client POSTs `read-observed/init`.
One atomic D1/libsql batch validates the current actor and peer/membership, seeds
only currently readable objects that the existing timestamp baseline already
regarded as read, and records exact mode. An already initialized scope cannot
seed again. A lost init response can therefore be retried without swallowing a
later backdated message. This retains historical read state; it does not claim
that the old timestamp history proved actual display.

Modes are keyed by viewer, kind and peer/community, with the resolved stored
conversation and current `joined_at` membership epoch. A conversation ID alone
is not authority: historical IDs could collide. Both seed and ACK require the
actual sender/recipient pair and indexed recipient link, or the community's
current membership and chat-object audience. Blocked/deleted objects and revoked
memberships cannot authorize ACKs. Init and ACK use SQL CHECK assertions before
and after the payload in the same batch; failed assertions roll back all writes.

Community object eligibility also applies the current viewer's canonical
personal block/mute predicate, matching the community message reader. Hidden
chat cannot be newly seeded at init, accepted in an exact ACK, or added by a
legacy mark-current operation in exact mode. A mixed allowed/hidden ACK fails
atomically. Another member's receipts are unchanged. Removing a relation can
restore eligibility, but never supplies an observed receipt by itself; an
already legitimate receipt is retained rather than deleted by moderation.

Group initialization preserves the existing `COALESCE(last_read_at, joined_at,
epoch)` bootstrap policy. Its suppression of pre-join/history timestamps is
legacy state, not proof of observation. The exact contract starts at successful
init. Leaving or changing the membership epoch removes modes/receipts; rejoining
requires a new init and cannot reuse the old membership's mode.

## Exact ACK and reads

POST `read-observed` accepts `{"message_ids":[...]}` with 1–50 unique nonempty
IDs, at most 2048 UTF-16 code units per ID and 32768 bytes of JSON body.
The client must send only rendered/checked messages, not merely fetched rows or
messages beyond an unchecked gap. No server timestamp is used as an observed
high-water mark. Unknown, wrong-peer, stale membership and uninitialized IDs
fail atomically; accepted duplicate requests are idempotent.

The IDs are a single bounded JSON parameter queried with `json_each`; no
unbounded parameter list or per-ID batch statement is generated. Initial legacy
seeding is an indexed set-based query for one conversation, without loading its
whole history into JavaScript. Large-thread initialization still has real DB
work; portable tests do not establish production D1 latency or capacity.

Both rich contacts and shared nav/push unread counts use receipt absence in
exact mode, without a timestamp fallback. Equal publication times, arbitrary ID
order and late/backdated arrivals therefore do not silently become read. Partner
DM pages expose `partner_read_message_ids` only for the authorized page. Exact
actors' `partner_last_read_at`, group legacy `read_states`, and timestamp
`talk.read` events are suppressed rather than treating a time as proof that all
preceding messages were seen. Group per-message receipt display is not yet
provided; its legacy receipt is conservatively unknown in exact mode.

## Old clients and lifecycle

An old client can still call `/read`: it deliberately marks the currently
readable conversation, not an observed ID set. If exact mode exists, that same
atomic operation records current IDs as well as retaining the legacy timestamp.
Such an explicit old-client call can include its own unobserved messages; this
is not a universal guarantee across old clients or concurrent devices. New
clients must never fall back to that endpoint after a missing/failed exact API.
Partner/group timestamp projections are unknown after opt-in. The legacy POST
keeps its operation timestamp in `last_read_at` for existing ACK decoders; that
response is not an observed-ID receipt. A colliding legacy thread enters
peer-specific mode within the same batch, and does not advance the coarse
timestamp shared by other peers. Non-colliding legacy-only conversations keep
their previous state and realtime behavior.

Object tombstone/deletion and actor/membership/community cleanup remove receipt
sidecars. New reader metadata has the existing account-deletion reservation
guards; an already removed parent permits orphan cleanup so another author's
deletion cannot be blocked by the reader's reservation. Account teardown also
explicitly purges the reader's modes and receipts. No FK to remote actors or
destructive rebuild of existing tables is introduced.

## Operation and remaining qualification

### Historical peer archives

Historical conversation IDs could represent multiple unrelated pairs.
New archives use `(viewer, peer)` identity and retain the selected stored
conversation ID as provenance. Rich contacts, archived contacts and shared
nav/push unread counts use one SQL predicate, applied before the page cap.
DM push delivery rechecks the same archive preference, so archiving after
enqueue suppresses delivery and unarchiving a legacy peer permits it again.
Incoming requests and their replies also use indexed sender/recipient pairs;
a reply to one colliding peer does not accept another peer's request.
The request list groups by stored conversation and sender, and excludes replied
pairs before its 500-pair cap. An already replied history cannot evict an older
pending request. Reject cleanup requires the authenticated viewer's indexed
`to` recipient membership at every selection stage; the same sender and stored
conversation alone do not authorize deleting a message addressed to someone else.
The request count is computed by a SQL aggregate over incoming pairs with
indexed reply existence checks, not a JavaScript list of all sent history.

Contact unread counts query only the selected `(conversation, peer)` page in
chunks of 75 pairs, with one JSON parameter per chunk. The 2,000-pair page
therefore needs at most 27 unread aggregate queries regardless of how many
different legacy read timestamps it contains. Each query joins the viewer's
indexed legacy baseline and retains the exact-mode receipt predicate; another
actor's baseline cannot affect the count. Orphan read metadata is neither
materialized nor pruned by GET. Pair-set membership also prevents unrelated
senders sharing a historical ID from expanding aggregate results beyond the
page. This bounds round-trips and returned metadata, not production D1 history
scan time, latency or capacity.

The migration preserves every old conversation-wide archive row unchanged and
creates no expansion markers. GET remains read-only. On an explicit archive or
unarchive, a single guarded batch seeds the old marker's currently indexed
peers with its original timestamp, records expansion, and changes only the
selected peer. Retries never seed it again. Unarchiving one therefore retains
the other known peers' previously archived state. A newly encountered peer
after expansion does not inherit another peer's ambiguous old marker. Original
coarse rows remain as historical data rather than being deleted or rewritten.
Reader account reservation guards and account/parent cleanup cover both sidecars.

After any peer-specific operation, an older runtime that ignores these tables
cannot faithfully represent that archive state. Keep this metadata and a
compatible runtime, or repair forward; an old-code downgrade is not a faithful
archive rollback. No durable target was mutated to qualify this source change.

Treat durable targets as protected. Apply the additive file through the product
owner's normal migration path before serving this engine; migration execution
and deployment require separate authorization. A partial schema must not serve
the new runtime. The file is idempotent and leaves existing state intact.

Before any opt-in, an old-code rollback ignores the new empty sidecars. After
opt-in, reverting to an engine that ignores exact receipts would restore weaker
timestamp behavior and may change badges/receipts. Keep a receipt-compatible
runtime or repair forward; do not delete sidecars, rewrite applied migration
history or restore only one metadata table. Message data remains unchanged.

Required source qualification includes migration preservation, init/ACK rollback,
legacy compatibility, current membership/recipient/block authority, both unread
projections, account and object cleanup, bounded requests and the actual App/Core
race. Native D1, real identity, installed clients, devices and federation delivery
are separate evidence; no live schema or credential operation is implied.
## Pending request rejection

New clients use `POST /api/dm/requests/reject-pending` and fail closed on an old
host's 404, without falling back to `/requests/reject`. The existing reject
route shares the guarded implementation for older clients on updated hosts.

Rejecting a request is restricted to the authenticated recipient, sender and
resolved stored conversation while that pair has no reply from the recipient.
A stale inbox does not authorize deleting an accepted conversation. Each page
revalidates the pending predicate and selected direct-Note ownership and
attachment snapshots inside the existing SQL CHECK admission boundary.
Activity/projection cleanup, media deletion intent, children and object removal
commit in one bounded batch. Physical media purge remains trailing.

The operation is atomic per page, not across the complete multi-page history.
A reply before the first page causes no deletion; a reply between pages stops
new page deletion with `409 request_changed`. Earlier committed pages remain
removed. Clients must reload and never treat this as a complete ACK or blindly
retry the destructive request. Optional blocking uses the same pending guard.
The sender-only public API still selects the peer's current stored conversation;
it does not identify a particular older request row.
## Owned DM mutation and readback

`GET /api/dm/messages/:messageId` is an authenticated author-only, no-store
reader for one direct Note. It does not open or acknowledge a conversation.
It retains the legacy author-owned direct-Note scope even when old records
lack conversation metadata; the native UI supplies IDs from its selected chat.
Chat/feed community objects are outside this scope. A supported missing/scope
result is `404 owned_dm_not_found`; an old host's generic 404 is not a deletion
receipt. Opaque AP IDs are decoded once by the router.

The response includes the message and an opaque `dm-v1` source fingerprint,
also returned as a quoted ETag. New callers provide that exact value in
`If-Match` for edit/delete. Older callers may omit it; all mutations still
recheck the current author, direct-Note scope, addressing, content, attachment
and timestamp snapshot in the existing SQL CHECK write boundary. A stale
precondition or a changed source at commit returns409 without that mutation's
effects. The fingerprint is not a new durable schema revision.

Object changes, Activity ledger and durable explicit-recipient resolution
intent co-commit. Deletion also includes old Activity/projection cleanup, media
intent and children before final removal; its new Tombstone Activity remains.
Physical media purge is trailing. A missing Queue or lost wakeup does not turn
a committed change into a failed edit; the established outbox drain recovers
the first-hop intent. Direct changes never enter followers/public fanout.

These guarantees are local mutation and durable delivery-intent guarantees.
The current inbound Note paths still discard Update before Create and do not
persist a Note tombstone for Delete before Create. Those ordering gaps remain
unfinished; queued intent does not prove remote arrival or final convergence.
Group mutation membership, post policy and fanout remain their own contract.
