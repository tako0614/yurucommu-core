# Session revocation outcomes

The browser cookie and native host Bearer are raw session credentials. The
database stores the salted hash. Logout selects the same credential as session
authentication: a nonempty session cookie wins over an Authorization header.

`POST /api/auth/logout` acknowledges `{ "success": true }` only after the
selected salted session has been deleted, or the delete successfully confirms
that no matching row exists. Without a credential it remains an idempotent
success. Deletion targets that exact session, not every session of an actor.
A successfully revoked credential must no longer authenticate through either
Cookie or Bearer; another session of the same actor remains usable.

Hashing or durable deletion failure inside the revocation helper produces HTTP
503 with the normal flat error envelope, `code: "SESSION_REVOCATION_FAILED"`.
Earlier authentication middleware can fail before reaching that helper; for
example, an initial credential-hashing failure uses its existing generic 500
`INTERNAL_ERROR` response. Neither failure is a revocation acknowledgement.
The route does not clear
the session cookie on that failure. The old credential may remain usable, and
the caller must present an unconfirmed sign-out rather than infer revocation
from local browser state. A failed or indeterminate write is not a success ACK.
The API package's `logout()` rejects non-success HTTP responses as `ApiError`,
preserving status/code; it does not retry the POST automatically.

Password login, OAuth callback, mobile exchanges and account switching share
the session-rotation helper. When an existing cookie is supplied, its deletion
must finish before cookie clearing or replacement session issuance. A failure
aborts rotation; mobile OIDC must report the storage failure rather than
misclassify a valid ID token as invalid. OAuth state/nonce consumption remains
one-use, so an unsuccessful callback may require a fresh login flow.

This contract preserves the existing cookie-only rotation behavior. Bearer-only
mobile login does not revoke another Bearer. Account switching still requires
its browser cookie. Broader cross-tab generation, issuer/token revocation,
atomic replacement across delete/insert, and operator backup/restore semantics
are separate contracts. In-flight requests already authenticated before logout
are not retroactively cancelled. Restoring a backup containing an old session
can restore that credential; this change does not introduce a revocation ledger.

No schema, salt fallback, actor ownership, persona or participant model changes
are involved. Generic Core and Yurumeet do not acquire Yurucommu's product-specific
single-human-owner premise from this auth fix.

Regression evidence lives in the owner tests: rejected SQLite DELETEs for both
logout credential forms and all rotation routes, hash failure, exact salted-row
deletion, Cookie-over-Bearer selection, sibling isolation, repeated logout and
tombstone/restore replay rejection. Native workerd/D1 failure injection on
product bundles is separate from libsql tests and from actual operator data.
