import { atom } from "jotai";
import { fetchCommunities } from "../lib/api.ts";
import type { CommunityDetail } from "../lib/api/communities.ts";

// --- Home view filter ---
//
// The individual is the base. Home shows the WHOLE reach (own + follows + every
// community you're in) by default; a community is just a named slice of people
// you can optionally narrow the view to. This is a transient VIEW filter, not a
// place you live and not a posting audience — it resets to "everything" on
// reload, and posting is decoupled from it (a post goes to your reach unless you
// deliberately narrow it).
//
// `personal` here means the unfiltered home ("すべて" — everything you can see);
// `community` narrows the view to that one community's people.
export type CommunityScope = {
  kind: "community";
  ap_id: string;
  name: string;
  display_name: string;
  icon_url?: string;
  member_role: "owner" | "moderator" | "member";
};

export type InhabitedScope = { kind: "personal" } | CommunityScope;

export const PERSONAL_SCOPE: InhabitedScope = { kind: "personal" };

// --- Pure reducers / derivations (kept side-effect free so Phase B and the
// tests can build on them without a DOM) ---

/**
 * Project a CommunityDetail (joined) into a community scope value.
 * Returns null when the community is not joined or its role is unknown.
 */
export function communityToScope(
  community: CommunityDetail,
): CommunityScope | null {
  if (!community.is_member || community.member_role === null) return null;
  // A list payload that omits member_role entirely (undefined) used to leak
  // through as `member_role: undefined`, violating the owner|moderator|member
  // type. The list API now populates member_role, but guard defensively: treat
  // a missing role on a member as a plain member rather than a bogus value.
  // (An explicit null still means "no resolvable role" and is dropped above.)
  const role = community.member_role ?? "member";
  return {
    kind: "community",
    ap_id: community.ap_id,
    name: community.name,
    display_name: community.display_name,
    icon_url: community.icon_url ?? undefined,
    member_role: role,
  };
}

/**
 * Reconcile a stored scope against the freshly fetched communities.
 *
 * - personal scope always survives.
 * - a community scope survives only if that community is still joined; its
 *   denormalized fields (name / display_name / icon / role) are refreshed from
 *   the live community so a stale label never lingers.
 * - otherwise we fall back to personal.
 */
export function reconcileScope(
  stored: InhabitedScope,
  communities: CommunityDetail[],
): InhabitedScope {
  if (stored.kind === "personal") return PERSONAL_SCOPE;
  const live = communities.find((c) => c.ap_id === stored.ap_id && c.is_member);
  if (!live) return PERSONAL_SCOPE;
  return communityToScope(live) ?? PERSONAL_SCOPE;
}

export type ScopeQuery = { community: string } | undefined;

/**
 * Derive the feed/API query fragment for a scope. Personal observes the whole
 * place (no community filter); a community scope filters to that community.
 */
export function scopeToQuery(scope: InhabitedScope): ScopeQuery {
  if (scope.kind === "community") return { community: scope.ap_id };
  return undefined;
}

/**
 * Build the list of scopes the owner can switch between: personal first, then
 * every joined community (preserving fetch order).
 */
export function deriveMyScopes(
  communities: CommunityDetail[],
): InhabitedScope[] {
  const scopes: InhabitedScope[] = [PERSONAL_SCOPE];
  for (const community of communities) {
    const scope = communityToScope(community);
    if (scope) scopes.push(scope);
  }
  return scopes;
}

// --- Atoms ---

// The active home view filter. TRANSIENT (not persisted) and defaults to
// `personal` = "everything you can see" — so a fresh load always opens the full
// unified home, and narrowing to a community is a temporary lens, not a place
// you get stuck in.
export const inhabitedScopeAtom = atom<InhabitedScope>(PERSONAL_SCOPE);

// Holds the latest joined communities used to back the scope picker and the
// reconcile pass. Populated by `hydrateScopeAtom`.
export const scopeCommunitiesAtom = atom<CommunityDetail[]>([]);

// Derived: the feed/API query fragment for the active scope.
export const scopeQueryAtom = atom<ScopeQuery>((get) =>
  scopeToQuery(get(inhabitedScopeAtom)),
);

// Derived: personal first, then joined communities, as switchable scopes.
export const myScopesAtom = atom<InhabitedScope[]>((get) =>
  deriveMyScopes(get(scopeCommunitiesAtom)),
);

// On a cold load BOTH AppLayout and the timeline page kick hydrateScope on the
// same mount (the timeline gates its first fetch on scope reconciliation; the
// layout needs the scope for the sidebar/header). Without deduping, that fired
// GET /api/communities twice. Share a single in-flight fetch so overlapping
// hydrations collapse to one request; cleared once settled so a later hydrate
// (e.g. after a join) still refetches.
let hydrateCommunitiesInFlight: Promise<CommunityDetail[]> | null = null;

// Action: hydrate the stored scope against live membership. Fetches the
// communities, refreshes the picker source, and falls back to personal if the
// stored community is no longer joined.
export const hydrateScopeAtom = atom(null, async (get, set) => {
  let communities: CommunityDetail[] = [];
  try {
    hydrateCommunitiesInFlight ??= fetchCommunities();
    communities = await hydrateCommunitiesInFlight;
  } catch (e) {
    console.error("Failed to hydrate scope communities:", e);
    return;
  } finally {
    hydrateCommunitiesInFlight = null;
  }
  set(scopeCommunitiesAtom, communities);
  const reconciled = reconcileScope(get(inhabitedScopeAtom), communities);
  set(inhabitedScopeAtom, reconciled);
});

// Action: refetch joined communities into the picker source without touching
// the active scope. Used after a join so a freshly joined community surfaces as
// a new ScopeBar pill. Returns the refreshed list (empty on failure).
export const refreshScopesAtom = atom(
  null,
  async (_get, set): Promise<CommunityDetail[]> => {
    let communities: CommunityDetail[] = [];
    try {
      communities = await fetchCommunities();
    } catch (e) {
      console.error("Failed to refresh scope communities:", e);
      return [];
    }
    set(scopeCommunitiesAtom, communities);
    return communities;
  },
);

// Action: enter a community as the active scope ("stand in the room you made").
// Refreshes the picker source so the community is present as a pill, then writes
// it as the active scope. Used after creating or joining a community.
export const enterCommunityScopeAtom = atom(
  null,
  async (_get, set, community: CommunityDetail): Promise<void> => {
    const communities = await set(refreshScopesAtom);
    // Prefer the freshly fetched row (authoritative membership/role); fall back
    // to the passed-in community if the refetch failed or hasn't propagated.
    const live =
      communities.find((c) => c.ap_id === community.ap_id) ?? community;
    const scope = communityToScope(live);
    if (scope) set(inhabitedScopeAtom, scope);
  },
);

// Action: reset scope to personal (wired into logout so a switched account
// never inherits the previous owner's community lens).
export const resetScopeAtom = atom(null, (_get, set) => {
  set(scopeCommunitiesAtom, []);
  set(inhabitedScopeAtom, PERSONAL_SCOPE);
});
