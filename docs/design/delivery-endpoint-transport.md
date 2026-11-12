# Federation delivery queue endpoint transport

Outbound ActivityPub queue delivery requires HTTPS by default. HTTP signatures protect
authenticity and integrity; they do not encrypt an Activity or private-message
body. `safeEndpointHost()` gates the selected endpoint before the delivery
worker reads signing material or calls its HTTP transport.
The explicitly enabled staging shadow probe uses the same endpoint gate before
signing or posting its secondary request; a rejected probe leaves the successful
primary delivery complete.

A retained HTTP endpoint job is failed explicitly with `invalid_endpoint`,
without posting its body, resetting its attempts/reconciliation budget, or
silently rewriting its endpoint to HTTPS. Actor discovery must advertise the
actual HTTPS endpoint. This does not automatically revive already failed jobs.

## Existing explicit local opt-in

The existing process option `YURUCOMMU_ENABLE_LOCAL_SUBSTRATE_REMOTE_FETCHES`
permits HTTP endpoint admission when explicitly enabled (the same truthy-value
contract as the existing local-substrate resolver). It is process-wide and can
also admit public HTTP peer endpoints; it is not a per-tenant permission or a
new production Worker binding. An absent process option leaves HTTP closed.
Self-host operators that intentionally use public HTTP peers need this explicit
option and accept that those payloads are unencrypted.

Existing URL safety checks still reject credentials, malformed endpoints,
private/link-local IP literals, loopback and blocked hostnames. This opt-in does
not bypass DNS/address validation, redirects, timeouts or HTTP signatures. In
particular, the existing `*.takos.test` local-address exception still requires
HTTPS:443 and its existing local address allowlist at the resolved-URL check.
An HTTP URL passing endpoint admission is not proof that it passes those later
transport checks.

## Scope and verification

This policy changes outbound delivery endpoint admission only. The generic
`isSafeRemoteUrl()` contract and actor-document fetch policy remain unchanged.
The Core/API package version, schema, queue budgets, credentials and consumer
pins are unchanged. Deployment and package adoption are separate operations.

Regression tests call the real delivery handler with disposable local data,
ephemeral fixture signing material and the existing injected delivery-fetch
port. They cover default HTTP refusal without a POST, retained retry-wait
budget preservation, ordinary signed HTTPS completion, explicit local HTTP
opt-in and private-target refusal. Resolver tests supply a local deterministic
resolver; they do not perform DNS or peer requests. These are source/local
checks, not real federation, production transport or installed-app evidence.

This transport gate does not change the shadow probe's recipient selection.
