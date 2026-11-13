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
The owning D1 and edge.sql factories reuse their base Drizzle client for the
identical binding object through weak object keys. Recreated request environments
can therefore share this recovery lifetime without caching requests, authority
guards, query results or configuration under a database name/URL. Separate
binding objects retain separate clients, even if they address the same database.
Per-request write guards remain separate facades over the base client.

A runtime recreating the binding object itself still has separate lifetimes.
This is not a stable global database identity registry or proof of the installed
runtime's binding-object lifetime. Factory construction performs no SQL or
provider call, and the underlying query, batch and row-shape contracts stay intact.

An accepted status is not proof of a durable write. A successful no-op can still
request recovery, while a write followed by a failed response waits for later
accepted traffic or periodic recovery. Durable intents, queue ACK/retry authority,
retention SQL, authentication and provider delivery contracts stay unchanged.
Local Queue port fixtures do not qualify real delivery, D1 cost/latency, waitUntil
budgets, installed Worker configuration or deployment.
