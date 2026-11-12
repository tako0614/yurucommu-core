# ActivityPub actor authority and persisted keys

`isSameActivityPubActor` compares actor authority at the verified-key binding,
Follow responses, object ownership and RTC peer boundaries. The inbox's
`isActorMismatch` delegates to it. It compares parsed query strings exactly
before applying the existing cosmetic normalization. A query value ending in
`/` therefore cannot grant authority for the value without that slash.
Query case, parameter order and encoded bytes remain significant.

Equal queries retain existing scheme/host case, default-port and fragment
handling. The existing terminal path-slash equivalence without a query remains.
Exact nonempty strings still take the existing fast path; this comparator is
not URL admission, a remote-actor document validator or proof of key ownership.
The signature verification and per-handler admission checks remain necessary.

`normalizeActivityPubActorId` also supplies persistent tombstone, deletion,
update-order, moderation and inbound-ledger keys. This repair deliberately keeps
its byte output and every existing SQL/data consumer unchanged. Its historical
terminal-string slash rule can still collide for query-tail variants in those
stored keys. Correcting that representation requires a separate compatibility
and retained-data design; changing the pure comparator does not close it.

No schema, migration, package version, dependency, delivery or deployment change
is part of this source repair. Local predicate and signed-inbox regression
fixtures do not qualify genuine remote identities or deployed consumers.
