# Atomic owner claims

`createYurucommuBackendApp({ singleOwner: true })` enables an explicit product
composition policy. The default is false. The generic engine and Yurumeet do
not acquire Yurucommu's one-human-owner premise from this change. Middleware
clones the request environment and sets its internal `singleOwner` boolean
from this app option; an operator binding cannot override the product option.
Direct integrations calling the auth helpers must explicitly pass that policy.

With the policy enabled, every auth owner creation uses one conditional
`INSERT SELECT ... WHERE NOT EXISTS` over live `actors.role = 'owner'` rows.
The write, rather than an earlier count or an isolate lock, decides the winner.
A tombstone revival and cancellation of its Delete activity and all delivery
projections use one ordered atomic batch. Every cleanup statement and the
final update require the same tombstone and, for an owner, no live owner.
A rejected claim leaves the tombstone, signer and queued Delete intact; a
failed update rolls cancellation back. Matching the generated fresh key after
the batch prevents a losing request from accepting another revival's row.
Member tombstone revivals in this mode also use atomic cancellation/update.

OAuth counts live owners in this mode, so restored member/tombstone rows do
not occupy the owner slot. Existing subject identities remain their existing
role; a pin or allowlist never promotes or links a member to the root. Normal
owner-pin, verified-grant and explicit unpinned-bootstrap authorization still
apply. The allowlist alone cannot bootstrap a rootless store. After a lost
claim, OAuth can recover only the same live provider subject; a distinct
subject is refused without an actor or session. Password requests have
already verified the instance password and may re-resolve the winner.
Persistence failures after mobile OIDC verification propagate as persistence
errors, rather than being classified as an invalid ID token.

No schema constraint, migration, automatic demotion or owner selection is
introduced. Existing multiple-owner stores remain unchanged and are not
qualified as one-owner stores. Password login in this mode returns 409
`OWNER_STATE_CONFLICT` rather than choosing an arbitrary legacy owner. Existing
OAuth identities retain their prior access; operator reconciliation of legacy
ownership remains a separate data/authority action. New owner writes cannot
add to a legacy store. Remote actors, owner-linked personas, rootless members
and community owner roles keep their existing boundaries.

This guarantee applies to writers using the policy and an atomic SQLite/D1/
portable SQL substrate. It cannot constrain other software or an opt-out app
writing the same database. Password and OIDC identities are not automatically
linked, and deleting/restoring an owner does not introduce a permanent human
identity reservation or a revocation generation. A password winner followed
by a new pinned OIDC login retains the existing rootless-member behavior.

Core/API 4.1.11 remain the published consumer identities during this source
change. Product enforcement requires a separately requested paired package
publication, verified registry bytes, public consumer adoption and explicit
Yurucommu composition opt-in. A green Core test or private consumer artifact
does not establish enforcement in the existing v2.3.0 release or a live store.
Tests of synthetic restored rows are not an operator backup/update drill.

In this mode, auth-session issuance also fences the exact live actor subject
and observed signing key in its single insert. Account switching fences both
requesting and target actor identities. Existing-subject profile updates use
that same predicate. A changed incarnation returns 409
`ACTOR_IDENTITY_CONFLICT` and receives no replacement credential. Revival
atomically removes any residual sessions for the reused AP ID before the
new identity becomes live. The signing key is an existing incarnation marker;
no session-generation column or durable human-identity reservation is added.
Password bootstrap resolves a free handle when an existing member uses `tako`.

Concurrent account teardown remains a separate pre-existing conformance gap:
its long destructive cascade/finalizer uses AP IDs without a durable incarnation
lease. A delayed second delete may affect a revived actor. This claim/issuance
fix does not qualify simultaneous deletion and restoration or resolve all
in-flight authenticated mutations. Operator restore/update and issuer evidence
remain independent GA dependencies.
