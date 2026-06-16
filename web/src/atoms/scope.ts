import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { fetchCommunities } from "../lib/api.ts";
import type { CommunityDetail } from "../lib/api/communities.ts";

// --- Inhabited Scope ---
//
// "Inhabited Scope" is the observation-scope / reach lens through which the
// owner looks at their place. It is NOT a visibility control: default post
// visibility stays public. Scope only changes what the viewer observes.
//
// `personal` is the always-present home scope (the individual's own place).
// `community` narrows the observation to a single joined community.
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

const SCOPE_STORAGE_KEY = "yc.scope";

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
  return {
    kind: "community",
    ap_id: community.ap_id,
    name: community.name,
    display_name: community.display_name,
    icon_url: community.icon_url ?? undefined,
    member_role: community.member_role,
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
  const live = communities.find(
    (c) => c.ap_id === stored.ap_id && c.is_member,
  );
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

// Persisted current scope. Defaults to personal and is mirrored to
// localStorage under `yc.scope`.
export const inhabitedScopeAtom = atomWithStorage<InhabitedScope>(
  SCOPE_STORAGE_KEY,
  PERSONAL_SCOPE,
);

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

// Action: hydrate the stored scope against live membership. Fetches the
// communities, refreshes the picker source, and falls back to personal if the
// stored community is no longer joined.
export const hydrateScopeAtom = atom(null, async (get, set) => {
  let communities: CommunityDetail[] = [];
  try {
    communities = await fetchCommunities();
  } catch (e) {
    console.error("Failed to hydrate scope communities:", e);
    return;
  }
  set(scopeCommunitiesAtom, communities);
  const reconciled = reconcileScope(get(inhabitedScopeAtom), communities);
  set(inhabitedScopeAtom, reconciled);
});

// Action: reset scope to personal (wired into logout so a switched account
// never inherits the previous owner's community lens).
export const resetScopeAtom = atom(null, (_get, set) => {
  set(scopeCommunitiesAtom, []);
  set(inhabitedScopeAtom, PERSONAL_SCOPE);
});
