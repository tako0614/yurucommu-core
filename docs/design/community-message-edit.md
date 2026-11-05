# Community chat message editing and deletion

The author of a chat Note can read one current message and conditionally edit it.
This is a source contract; package publication, installed host adoption and real D1 operation are separate.

`GET /api/communities/:identifier/messages/:messageId` requires authentication,
current community read access and exact authorship. It returns `Cache-Control: no-store`,
`community_ap_id`, the current `message` and a `group-message-v1:<sha256>` revision
with the same quoted ETag. Message IDs are opaque and decoded once by the router.
Only the reader's chat set is eligible: Note, no `community_ap_id` feed binding,
current community audience recipient, undeleted object/community and operator-unblocked author.
The payload SELECT includes the current community/membership rule. A supported missing chat
message returns `owned_group_message_not_found`; a missing community, denied access or a generic
old-host404 does not confirm message deletion.

`PATCH` retains its existing author/read permission and optional If-Match contract.
When supplied, If-Match must be the exact quoted group revision. Another revision returns409;
invalid or DM validators return400, with no write. Legacy callers without a validator still
operate on a current server read. The successful response retains `success: true` and adds the
community identity, saved message content/update time and next revision.

The revision is a content/authority observation, not a capability or durable schema counter.
Before updating, an existing atomic write guard rechecks the selected source, exact author,
chat audience and scope, operator policy, live community and its current read rule. A stale
source or revoked private membership aborts the batch with409 and no payload effects/marker residue.
The request's actor-admission guard still composes with this target guard. SQL/driver errors
other than the guard conflict remain errors. No interactive transaction or schema change is added.

Public-community authors retain the pre-existing ability to edit their own messages without
membership. A changed new-message post policy does not revoke editing of existing history.
Moderators do not gain permission to edit another author's content.

The existing community-chat local persistence and receive-refresh behavior is preserved;
this edit path does not invent a new ActivityPub delivery or realtime event contract.
Community deletion/moderation, attachment replacement and group creation are separate operations.

## Conditional deletion

The author-only single-message GET additionally advertises
`message_actions.delete = { version: 1, precondition: "group-message-v1" }`.
This field is an observation of the implemented conditional DELETE contract,
not permission or a durable server lease. New clients must not send a Group
DELETE based only on the earlier editing reader: that host could still ignore
If-Match. Missing/unknown delete metadata disables that operation while editing
can continue. Mixed-version rollback/routing still requires owning host release
qualification; the hint does not pin a server version across requests.

`DELETE /api/communities/:identifier/messages/:messageId` keeps legacy callers
without If-Match and the existing author-or-current-manager permission. A quoted
group revision rejects a changed message with409; invalid/DM validators return400.
Message IDs are decoded once. The response retains `success: true` and binds the
acknowledgment to `community_ap_id` and `message_id`.

The same live-community/current-read/chat-source guard permits the author or a
current owner/moderator at commit. Role removal, private membership revocation,
source changes and audience/scope removal abort without payload effects. A
manager can still remove an operator-hidden retained chat message: deletion
serves no message payload. This does not expand author-only GET/PATCH access.
Public authors, including legacy NULL visibility, keep the existing membership
semantics. Feed posts and deleted communities remain outside this route.

The existing read-only cascade planner supplies child cleanup and durable media
intent. These statements and final object removal commit in one guarded atomic
batch. A final-object failure rolls back all preceding effects. Physical media
purge runs afterward; storage failure retains durable pending intent for the
existing drain. No new schema, transport or ActivityPub/realtime event is added.

Native clients show a confirmation with current server content, preserve compose
drafts and fence an unknown ACK without resending. Exact author readback can
resolve supported absence; generic404 or revoked access cannot. A conflict
requires fresh content and another explicit confirmation. Moderator actions are
not exposed by the author-only native UI.
