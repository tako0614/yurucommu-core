# Federation fetch deadlines

`fetchWithTimeout` bounds URL safety and DNS preflight together with the HTTP
headers phase using the configured `timeout`. A caller abort also returns
while DNS is still pending, preserving the caller's supplied reason. An
absolute `deadline` bounds admission before validation, the pending validation
wait, and admission again immediately before HTTP.

The timer and caller listener are installed before validation and removed in
one `finally` path. Late resolver success or rejection is consumed, and cannot
resume the timed-out or cancelled request. This does not cancel the underlying
native DNS lookup or prove that it stopped consuming resolver resources.

Immediate safety/resolver errors retain their original identity. An absolute
deadline reached while awaiting validation returns `Federation request deadline
exceeded`. Header-phase aborts retain the existing `Request timed out after…`
error; the body keeps its existing separate read timeout and size cap. Redirects
remain manual and refused. `skipSafetyCheck` skips validation, while the request
timer and caller abort still apply.

The helper is shared by remote actor and signing-key GETs, durable signed
activity POSTs, and other federation requests. Bounding the wait does not bind
the actual connection to the validated address set: connection-IP pinning,
Worker/hosted behavior and live federation remain separate qualifications.

The portable regression holds a mocked resolver gate in fresh Bun processes,
requires return before releasing it, then checks zero late peer requests and
zero unhandled rejections. Separate controls retain the header error and the
identity of a resolver's own AbortError. The owning gate also runs the existing
resolver selection, SSRF and RTC deadline tests. These are portable evidence,
not actual native DNS cancellation or a published consumer update.
