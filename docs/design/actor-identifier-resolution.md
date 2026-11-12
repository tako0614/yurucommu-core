# Cached actor identifier resolution

Actor profile and relationship routes use `resolveActorApId` for a bare local
username, `@username`, `username@domain`, `@username@domain`, or a full AP ID.
This helper resolves existing local/cache state; it does not perform WebFinger,
DNS, remote authentication or a new actor fetch. It is not a proof of ownership
of a federated account or a mapping of WebFinger aliases to a different AP host.

Bare names retain the existing `actorApId(APP_URL, username)` mapping. A handle
whose authority matches the local base URL resolves the same way. Existing full
AP ID handling is unchanged, including path/query identity and byte-preserving
return of the supplied ID; downstream existence/read/block policy still applies.

For a remote handle, the username is an exact SQL parameter. Its domain must be
an HTTP(S) authority, without whitespace, userinfo, path, query, fragment, percent
escapes or an empty port. URL parsing normalizes host case, IDNA, IPv6 spelling
and each scheme's default port. A cached AP ID must be a valid HTTP(S) URL without
userinfo, and its parsed `host` must equal the requested authority normalized
under that candidate's scheme. A domain string in a path/query or host suffix
cannot select an actor. Non-default ports remain significant. There is no new
network/SSRF policy imposed on cache-only local/private-host reads.

The cache has no unique username/host key. The query reads only AP IDs for at
most **101 rows** of the exact username, without LIKE, data-sized IN lists or
unbounded result paging. Up to 100 rows can be inspected. At 101 rows the helper
returns null, even if a matching row was seen: uninspected rows must not silently
change the selected identity. This is a bounded interim cache lookup, not a host
index or a database CPU/scan guarantee. Common usernames across many instances
can therefore require the caller to use a full AP ID. A persisted host index
and its data transition are separate work.

Within that set, multiple different actor IDs on the requested host are
ambiguous and also return null. Only the existing `isSameActivityPubActor`
cosmetic equivalence can treat duplicate cache representations as one actor;
path case and query differences remain identity-significant. The helper returns
a stored AP ID, without rewriting it. Null becomes the existing 404 at profile
and relationship entrypoints. Using a full AP ID remains the explicit recovery
path; ambiguity does not delete cache rows or disable other account operations.

The route's session admission, operator blocks, follow/read gates and cache
hydration policy are unchanged. No credential, schema, version, dependency,
federation delivery or deployment change is part of this repair.
