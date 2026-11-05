# Inbound Delete source admission

An inbound object Delete must still refer to the retained source it authorized
when each cleanup batch commits. This supplements the dispatch-claim lifetime
contract; it does not establish arrival ordering for remote activities.

## The race

Signature verification and the initial retained-author check authorize the
requesting actor. They do not reserve the object across subsequent awaits.
Another signed Delete can remove that object, and a signed Create by another
actor can then occupy the same object id before the older cleanup batch runs.
An unconditional object-id cascade would delete the new author's object and
projections even if the old dispatch later fails its own claim commit.

The regression exercises that schedule through the real signed inbox routes.
It pauses the first cleanup at the database batch boundary, completes the
second signed Delete and replacement Create, and compares the replacement
object, recipients and notifications before and after the old batch resumes.

## Commit boundary

`handleDelete` captures the retained object's id, raw author, type, local flag,
content, summary, attachments, reply/conversation, reach, tags, community,
lifetime/publication, update marker and deletion marker. After
the existing actor-identity check, it gives the cascade a request-local guarded
database. Each actual mutation batch admits only a row matching that snapshot.
The assertion and payload use the existing transactional D1/libsql batch
primitive. A failed assertion aborts that batch and preserves retryability.

Content and reach are compared directly: a same-author Create can replace a
deleted object with changed content while leaving `updated` null. An update
marker alone cannot distinguish that replacement.
The raw author comparison is against the retained value, not a rewritten
actor id. The initial check still accepts the existing narrowly normalized
ActivityPub actor identity. Like and reply counters are excluded from the
snapshot so unrelated interactions do not invalidate cleanup.

The guarded database covers child/projection cleanup, media-deletion intent
and the final object/counter transition. Physical media purge runs after the
object is gone, through the original request database and the existing
media-journal/reference checks. The now-absent object cannot satisfy a deletion
admission predicate, so that trailing purge must not use the object facade.
No outer request authority is removed or replaced.

## Retry and limits

A source change raises a retryable dispatch error rather than acknowledging
cleanup that used stale ownership. The tests also interleave a changed-content
Create by the same author and a signed Update. Both stop the older cleanup
until a fresh Delete retry. Normal first-acknowledgement, duplicate delivery and genuine SQL
failure recovery retain their existing claim oracles.

This is a fence at each batch, not a transaction around the whole cascade.
Earlier cleanup stages may already have committed before a later conflict;
the existing retry path remains responsible for convergence. The snapshot is
not a durable object-generation receipt and does not detect an identical
same-author replacement. Delete-before-Create and Update-before-Create ordering
remain separate work. Actor deletion is unchanged.

The portable regression uses the owning D1-semantics fixture with real SQL,
foreign keys and bounded statement/parameter checks. It does not qualify a
live D1 database, a deployed application or remote Fediverse delivery.
