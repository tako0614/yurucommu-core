# Inbound object Delete claim lifetime

A verified inbound object Delete owns a fenced dispatch claim until the inbox
commits its Activity as processed and releases that exact token. Removing the
object's notification and delivery projections must not remove this one claim:
otherwise the effects can complete while the outer inbox returns retryable503
because its commit witness disappeared.

The owner-checked Delete handler passes its canonical, signer-bound Activity ID
through the object cleanup helper. Projection cleanup excludes only that exact
claim; it still deletes all other selected claims and the normal inbox, push,
delivery and object-child projections. The Activity ledger remains retained.
The existing inbox token check and release/duplicate handling are unchanged.
No time budget, schema, signer or object-owner check is weakened.

Other object-cleanup callers omit the optional hint and retain their original
all-selected-claims cleanup. Hard Activity deletion cannot preserve a claim for
the Activity it removes, even if its caller reused an options object containing
the projection-only hint; its existing write guard still applies.

The signed user/shared inbox regressions require the first successful Delete
to return202, mark the original Activity processed, release its current claim,
and leave no object/recipient/inbox rows. Repeating the same wire Activity is
idempotent. Another correctly signed same-origin actor cannot delete the Note.
A real final object-delete SQL failure is observed at the driver, returns503,
retains a released retry claim and can complete when the same Activity retries.

This is a dispatch-lifetime guarantee. Existing remote Delete child cleanup
and final object/counter batches remain separate; the change does not promise
whole-cascade rollback on final object failure. It also does not introduce a
Note tombstone or close Create/Delete arrival-order races, stale Updates,
real-D1 execution, remote convergence or deployed-service qualification.
