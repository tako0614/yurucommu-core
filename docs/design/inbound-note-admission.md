# Inbound Note identity admission

An inbound Create may insert a new remote Note, or idempotently repair the
projections of a retained remote Note belonging to the same verified author.
It must not add recipient, notification or counter effects to another author's
object merely because its object ID shares the signer's origin.

The HTTP-signature ingress binds the dispatched actor to its verified key
owner. Object identity validation separately requires a bounded, safe, nonlocal
object IRI on that actor's origin. These checks do not make two actors on the
same origin interchangeable.
Historical author spellings use only the existing narrow actor-IRI equivalence
accepted by signature ingress. Path case and query changes remain different
identities; a repair does not rewrite the retained author.

Direct and generic Note Create writes use the existing atomic admission guard:
the object ID must either be absent, or still identify a nondeleted remote Note
with that exact canonical author. The check and projection writes share a D1
batch, so a competing Create cannot win between a preliminary read and an
unguarded recipient insert. Subsequent notification writes check the same
identity again. A collision is ignored with the inbox's normal 202 response;
unrelated database failures still return retryable 503 and retain the original
unprocessed Activity.

Same-author recipient repair, direct/shared inbox routing, current block/mute,
reply-read and community gates remain in force. Story and actor-document
handlers retain their own contracts. This guard does not order updates from
the same author or introduce a provisional object owner or Note tombstone.

The signed-route regression uses distinct cached signing keys and the owning
D1-semantics fixture, then calls the canonical post reader as the unintended
recipient. It covers direct and hidden-recipient generic collisions, an actual
second signed Create at the first write boundary, same-author repair, retained
type/local/deleted conflicts and a real SQL failure followed by the same wire
Activity retry. It does not qualify a deployed Worker or real D1.

Update-before-Create, Delete-before-Create and stale same-author replay remain
separate ordering work. The normal remote Delete's current dispatch-claim
cleanup must also be qualified independently; accepted outbound intent alone
does not establish remote convergence.
