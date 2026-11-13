# Cached actor name-search visibility

Ordinary `/api/search/actors` is a local/cached name lookup. Local private or
deleted actors retain their existing exclusion. Cached remote documents with
literal boolean `discoverable:false` or `manuallyApprovesFollowers:true` are
excluded before the existing scan cap, merge, sort and pagination. This mirrors
the existing local non-discovery policy without fetching a remote actor.

An exact local actor row remains authoritative for its ID. A stale cached copy
cannot reintroduce a private/deleted local actor or replace local metadata.
Once that row is physically removed, this exact-row exclusion alone is not a
durable deletion receipt. The cache query excludes IDs present in the local
actor table; local
public results still come from the original local query.

False/absent/nonboolean lock flags, true/absent/nonboolean discoverability flags,
and malformed/null/array documents retain the previous public cache default.
Guarded JSON predicates inspect the literal types in SQL without transferring
the full document to the application. Unknown/malformed data is not promoted
to a new privacy declaration. This is not a DB CPU or document-byte guarantee.

Existing literal name matching, leading `@` handling, operator-block filtering,
result fields, ranking, scan bounds and pagination stay unchanged. An actor
opting out of name search retains its existing exact-ID profile path; the
separate full-handle `/api/search/remote` discovery/fetch contract is untouched.
No new identity proof, network call, credential, schema or delivery is added.
Cache freshness/trust/takeover and installed/live interoperability are separate
qualification from these local source regressions.
