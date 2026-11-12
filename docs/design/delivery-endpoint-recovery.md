# Durable endpoint invalidation recovery

A selected delivery HTTP claim that receives 404 or 410 retains recovery state
on its existing endpoint job before resolving recipients. This design bounds
work while preserving the tail across Queue loss, process restart and terminal
HTTP status. It does not authorize delivery to a new audience.

## Authority and progress

The selected processing token starts a recovery generation. Creation of the
marker and expiry of the known-bad endpoint cache commit together, before any
resolution wakeup. Another HTTP claim joins pending progress; a stale claim
cannot replace it. A completed generation cannot be restarted by that same
claim. HTTP retry (8) and reconciliation (5) budgets remain independent.

Each invocation scans at most 2000 positive recipient rows in pages of 200,
using the retained (Activity, endpoint) recipient projection and an actor-ID
keyset cursor. Neither a shared cached inbox nor an unknown legacy recipient
set supplies authority. Removed bindings and verified actor tombstones are
checked again in the page write. Activity deletion still owns projection
cleanup. Existing strict moderation and downstream resolution/delivery checks
remain in force; an unavailable moderation read leaves the page unconsumed.

A separate recovery processing token fences each invocation. Every conditional
resolution insert or terminal reopen and the cursor advance belong to one
atomic batch. An old generation, old processing token or old cursor cannot
insert/reopen work even if it loses ownership between selection and commit.
The bounded VALUES CTE uses at most 15 three-value rows per statement, keeping
D1 queries below 100 bound parameters and avoiding compound SELECT limits.
A page uses at most 15 statements including its cursor update (batch limit 50).

## Wakeups, failures and retention

`recover_endpoint` carries only job ID and generation hints. The database owns
pending state, cursor, claim, due time and dependency retry count. Resolution
wakeups publish already-committed rows without inserting or reopening them.
Queue success does not consume recovery. Failed publication or an interrupted
claim is recoverable from the database; invalid claim/due timestamps fail
closed. A separate bounded scan of 50 due recovery jobs runs independently of
the 500 active HTTP jobs, including jobs whose original HTTP status is failed.
The ordinary resolution outbox sweep recovers lost recipient wakeups.

A dependency failure keeps unconsumed progress, clears only its owned claim,
and defers it for 60 seconds without charging remote resolution/HTTP budgets.
A partially completed window continues at its persisted cursor. Duplicate or
superseded wakeups have no authority to reset progress or exhausted budgets.
Terminal endpoint reaping excludes pending recovery in both selection and
conditional deletion. Once all pages have committed, ordinary retention and
projection cleanup resume. Resolution outbox retention remains independent.

## Migration and runtime adoption

0040 adds only columns and an index to `delivery_queue`. Existing job/recipient
rows, original errors, retry budgets and migration history remain unchanged;
old jobs default to no pending recovery and receive no inferred generation.
There is no backfill from actor cache or historical HTTP failures.

Apply before serving this engine, with old delivery writers/consumers closed.
After new recovery state is accepted, an older engine that ignores it can reap
or strand authority and is not a safe runtime rollback. Preserve the database
and repair forward; reverting package source alone is not a recovery plan.
An interrupted migration must be reconciled using the owning migration ledger
and actual schema, without blindly replaying ALTER TABLE statements.

Qualification uses disposable synthetic data, actual engine functions and
local workerd D1 for SQL/batch semantics. It does not qualify production D1,
real remote delivery, package publication, deployment or consumer adoption.
