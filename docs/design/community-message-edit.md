# Community chat message editing

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
