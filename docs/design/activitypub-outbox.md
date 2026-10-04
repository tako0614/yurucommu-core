# Public ActivityPub outbox reads

For joined objects, an unauthenticated outbox read exposes only public/unlisted
permanent Notes. Public-addressed Announce of an absent remote object is also
admitted under the separate addressing rule below; its target type is unknown.
Personal outboxes exclude community audiences; a public Group's own outbox
admits its Announce of a public/unlisted Note. Both joined-object gates reject
operator-blocked authors using the same actor/domain identity matcher as other
moderated collections. Retained rows during an incomplete purge therefore do
not remain public through the outbox while the canonical object read denies
them. Filtering happens before the page limit and cursor, and the count query
uses the identical predicate. An unblock makes retained allowed rows visible
again without changing the activity ledger.

An Announce with no joined object can represent a legitimate remote boost.
Its stored envelope must contain the exact Public collection IRI in root `to`
or `cc`, as a string or a string entry in an array. Public mentioned in content,
extensions, nested objects, recipient maps or an IRI substring does not admit
the activity. JSON escaping is decoded. Malformed JSON and duplicate `to`/`cc`
keys are excluded before counting/paging; JSON1 and JavaScript parsing can
otherwise select different duplicate properties. Core does not perform JSON-LD
context expansion to decide this gate. Current repost writers use fixed public
string-array addressing and check the object's boostability and operator block
before writing. The retained-data predicate is not evidence of an inbound
private-repost exploit.

## Remaining moderation boundary for orphan boosts

`migrations/0003_activity_remote_object_edges.sql` makes `activities.object_ap_id`
a plain AP-ID string, without an object FK. Object deletion retains activity
ledger rows for history/Undo and removes the `announces` edge. After an operator
purge, a local user's prior public Announce can consequently have no joined
object, keep its target string and satisfy the absent-object public-address gate.
The deleted author's identity cannot be recovered reliably from the target URL.
The joined-author filter and exact-address check do not close this orphan case.

Closing that boundary requires an explicit durable provenance or targeted
moderation-cleanup policy that preserves legitimate remote boosts and the
history/Undo contract. Neither the activity processing flag nor verified
Delete(Actor) tombstones represent operator moderation. This reader change
adds no schema or cleanup mutation and does not qualify complete moderation or
GA. Local libsql, disposable D1/workerd, published package and live federation
checks are separate evidence.
