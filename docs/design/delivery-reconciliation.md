# Durable endpoint reconciliation

`delivery_queue` owns endpoint retry state. Queue messages are at-least-once
wakeups; their optional `reconcileAttempt` cannot grant or reset a retry budget.
New endpoint materialization starts at generation zero. A delivery series has
the existing eight-attempt budget. After retry exhaustion, one conditional
update records `dead_letter`, its error, a six-hour `next_attempt_at` due time,
and `dlq_pending = 1` when its generation is below five. Generation five is
terminal: no additional reconciliation intent is created.

The structured DLQ notification remains useful for diagnostics and a delayed
reconcile wakeup. Failed publication can be retried by an incoming endpoint
wakeup without another HTTP POST. Its successful send does not consume the
repair intent. In particular, the local in-memory Queue can accept a message
and lose it on process restart. Independently, cron/local-startup endpoint
sweeping scans up to 50 due repair intents and republishes their exact successor
to MAIN. This scan is separate from the up-to-500 active endpoint scan. Sweeping
retains the intent even when the send succeeds or throws; if MAIN automatically
dead-letters or loses that wakeup, a later sweep can recover it again.

The reconcile worker consumes the intent with one conditional update requiring
`dead_letter`, pending intent, the exact predecessor generation, and the due time
having elapsed. It increments once, resets attempts and claim ownership, clears
the intent, and marks the row pending. Duplicate, older, future, permanently
failed, delivered or deleted jobs cannot reset attempts or resurrect a row. An
early valid wakeup is deferred; invalid durable timestamps require operator
repair. A failed or lost post-transition send leaves a pending row that the
ordinary sweep recovers at the persisted generation. Terminal retention excludes
unconsumed intents in both its selection and conditional delete.

Delivery admission reads the persisted generation and conditionally claims the
same generation, endpoint, Activity and due job with a new random processing
token. Every post-claim state write checks the token, generation and processing
status, so an older claimant cannot overwrite a replacement claim. This does
not promise exactly-once remote delivery: an HTTP acceptance followed by failed
bookkeeping or a crashed worker can still leave ambiguous remote acceptance.
Activity IDs remain the remote deduplication identity. HTTP success is ACKed
without an immediate repeat POST even when bookkeeping throws.

## Migration and recovery

Apply migration `0033_delivery_reconciliation.sql` before serving this engine,
with delivery writers/consumers closed during the transition. It adds columns
and an index without rebuilding tables or removing history or recipients.
The old engine persisted reconciliation history only in Queue messages. Existing
rows therefore receive generation five and no intent; existing statuses and
attempts stay intact. Active legacy rows can finish their current delivery
series, but receive no additional reconcile cycles. Older in-flight messages
cannot lower that conservative value. New producer inserts explicitly choose
zero; conflicts do not reset a pre-existing budget. The SQL and Drizzle defaults
both remain five so omitted-generation writers do not silently mint a new budget.

This availability tradeoff avoids claiming an exact recovered generation from
unavailable history. Historical dead-letter rows and dropped pre-migration DLQ
notifications require exact operator-data audit and adjudication; this migration
does not revive them. No automatic backfill infers their intent. Snapshot the
operator-owned data and inspect pending/terminal jobs before application. Do not
overlap old consumers: they ignore durable generations and can unconditionally
revive rows. New code requires the columns. Old code can read the additive schema
but ignores its bounds and intents, so code rollback alone does not preserve this
contract. Use a compatible forward repair, or restore a qualified pre-mutation
snapshot with writers closed and explicitly account for intervening deliveries.

Portable tests model bounded D1 statements; disposable actual-source D1/workerd
checks qualify SQL/CAS semantics separately. Neither qualifies real Queue
delivery, federation, cron, monitoring, production migration or operator recovery.
