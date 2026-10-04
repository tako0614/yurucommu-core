# Viewer-scoped outgoing Follow state

Authenticated `GET /api/actors/:identifier` returns
`actor.outgoing_follow_status`: `none`, `pending`, or `accepted`. It describes
the current authenticated actor's outgoing relationship to the resolved target,
including cached remote profiles. Self reads return `none`; anonymous reads
omit the field. The SDK preserves legacy omission and rejects a present value
outside this enum. Consumers can restore an approval-pending control from a
read rather than issuing a duplicate Follow mutation. Duplicate POST refusal
is unchanged.

`is_following` and `is_followed_by` remain accepted-only. Remote profile reads
now compute these booleans from the same viewer-scoped relationship instead of
hardcoding false. Pending/absent/rejected legacy edges do not grant accepted
authority or change counters or follower/following lists. Accepted wins if
legacy cosmetic duplicates coexist; a read does not repair those stored rows.

For remote targets, match only the cosmetic Actor IRI equivalence already used
by verified federation mutations: scheme/host case, default port, fragment,
and one trailing slash. Path/query identity stays significant. SQL narrows to
the indexed exact local viewer endpoint before applying the existing
materialized identity matcher, with a fixed number of parameters. A remote
cache recovery relationship belonging to another viewer never supplies this
viewer state. Operator-blocked actors still fail their existing read gate.

Authenticated profile responses use `Cache-Control: private, no-store`; every
profile response varies on Cookie and Authorization. The field is not added
to generic summaries, search or follow-list projections. This reusable Core
contract imposes no product ownership model and makes no schema transition.

Source/SDK and disposable native D1 qualification are separate from publication
and actual consumer use. Both npm packages still await their owning paired
immutable publication and registry readback; products must then adopt the
published contract and pass their own gates. Operator-data and live federation
qualification remain independent.
