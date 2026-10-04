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

## Withdrawal when a stored object is deleted

Migration `0032_outbox_revocations.sql` adds an Activity-ID sidecar, without
changing retained Activity rows or rebuilding existing tables. An `objects`
AFTER DELETE trigger records each existing Create, Update and Announce that
references the deleted object's exact AP-ID. The write commits or rolls back
with the deletion, across local/remote deletes, moderation purge and account
teardown. It includes legacy Activities with no direction; it does not update
another actor's reservation-protected Activity ledger. A common NOT EXISTS gate
excludes revoked rows before personal, instance and Group count/cursor/limit.
Recreating the object or removing a block never republishes an old revoked
Activity; a new Activity has a different publication lifetime. The Activity
DELETE trigger removes its sidecar row. Delete/Undo Activities are not revoked.
Normal unrepost still persists its Undo and reaps the original Announce.

The user repost writer records `direction: outbound`, like other outbound
producers, so its public Announce is actually included in the outbox. Its
existing object-existence and boostability guards still apply. This changes no
API response or package version.

Apply migration 0032 before serving this engine. For operator-owned upgrades,
close serving/writers, preserve a backup, apply the owning migration runner,
verify the exact ledger and reopen with the corresponding engine. The sidecar
is a read security boundary; an older runtime ignores it and may republish
withdrawn history. Recovery therefore requires a runtime that honors this
boundary, using forward repair rather than reopening on older code. No live
migration or operator-data qualification is implied by source/local tests.

## Legacy absent targets remain unclassified

Migration 0003 makes `activities.object_ap_id` a plain AP-ID string without
an object FK. Before migration 0032, object purge could retain a local public
Announce, remove its object and edge, and lose the deleted author's identity.
That author cannot be recovered safely from the target URL. The new trigger
only captures deletions after installation; it does not backfill or quarantine
all old unknown-object boosts. Their exact Public addressing contract remains
unchanged. Adoption needs a read-only audit of exact operator data and an
explicit adjudication policy for historical orphan rows. Zero affected legacy
rows or qualified individual remediation is a condition for a complete
moderation boundary; this prospective repair alone is not GA.

## Envelope syntax and page/count parity

Every public outbox requires a strict JSON object at the stored envelope root,
including joined-object Create/Announce and public Group Announce. Invalid JSON,
JSON null, arrays and scalar roots are excluded before totalItems, cursor and
limit. JSON1 type evaluation is guarded by json_valid so a malformed historical
envelope cannot raise a query error. Filtering only during response parsing
would let invisible rows inflate totals or consume a page. Activity history is
retained, and normal joined objects and unknown Public boosts remain supported.
This is syntax/root validation only: it does not independently validate all
Activity fields, duplicate keys in joined envelopes, or joined-envelope
consistency. The absent-object Announce branch separately rejects duplicate
addressing keys under its existing Public-address rule.

Local libsql, disposable actual-source D1/workerd, published package bytes and
live federation checks are separate evidence. General same-AP-ID Delete revival
remains a separate concern.
