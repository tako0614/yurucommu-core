# Actor follower and following member lists

The actor API keeps the existing member-list policy for local private accounts:
only the exact owner sees the follower/following members. Non-owners still see
the public count, limit and offset, with an empty member list and `has_more:false`.

The same restriction applies to a cached remote actor whose document declares
literal boolean `manuallyApprovesFollowers:true`. Membership in the mirrored
follow relation does not confer owner access. The cache remains a local mirror;
this route performs no new remote fetch, identity proof or refresh.

Local actor policy takes precedence over any cached spelling of the same ID.
A local public account stays public and a local private account stays private.
For remote actors, false, absent or nonboolean flags keep the prior public
mirror behavior. Invalid JSON, null and array documents also retain that
behavior; no broader unverified privacy policy is inferred from malformed data.

The database projects only the boolean using guarded JSON inspection, rather
than transferring the whole remote document. Existing accepted-edge filters,
operator blocks, ordering, pagination bounds, counts, response shape and exact
owner check remain unchanged. Cache freshness, flag trust and takeover policy
are separate concerns. No schema, dependency, credential or delivery change is
part of this repair; local fixtures do not qualify a deployed remote identity.
