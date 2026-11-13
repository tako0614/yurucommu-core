# Request-tail outbox recovery

The request tail requests recovery after accepted (2xx/3xx) non-read responses.
GET, HEAD and OPTIONS do not count as mutations. Failed responses do not request
an additional sweep. The existing isolate-wide 60-second traffic-driven recovery
still runs for any response when due; it is not a new timer or a delivery ACK.
Body-limit rejection remains before this middleware.

Requests sharing the same materialized `DB_INSTANCE` share an in-flight sweep
promise. Another accepted request marks it for a further pass, so a durable row
created after the current scan remains eligible before the shared lifetime ends.
The existing federation, push and realtime recovery order, error handling and
waitUntil/inline fallback are preserved. The stopping continuation releases the
entry synchronously, so later requests cannot join an already-finished loop;
different database objects do not share it.

This is a bounded source mitigation, not a global rate limit. A sustained stream
can require further passes; no elapsed-time or distributed capacity is promised.
Runtime adapters which recreate database wrappers per request do not share this
object identity and may run concurrent accepted sweeps. No database/client
identity registry or binding cache is introduced by this change.

An accepted status is not proof of a durable write. A successful no-op can still
request recovery, while a write followed by a failed response waits for later
accepted traffic or periodic recovery. Durable intents, queue ACK/retry authority,
retention SQL, authentication and provider delivery contracts stay unchanged.
Local Queue port fixtures do not qualify real delivery, D1 cost/latency, waitUntil
budgets, installed Worker configuration or deployment.
