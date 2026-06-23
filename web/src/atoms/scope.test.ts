import { assertEquals } from "#test/assert";
import { test } from "bun:test";
import { createStore } from "jotai";
import type { CommunityDetail } from "../lib/api/communities.ts";
import {
  communityToScope,
  deriveMyScopes,
  type InhabitedScope,
  inhabitedScopeAtom,
  leaveCommunityScopeAtom,
  PERSONAL_SCOPE,
  reconcileScope,
  scopeToQuery,
} from "./scope.ts";

function makeCommunity(
  overrides: Partial<CommunityDetail> = {},
): CommunityDetail {
  return {
    ap_id: "https://example.com/ap/communities/garden",
    name: "garden",
    display_name: "The Garden",
    summary: null,
    icon_url: null,
    visibility: "public",
    join_policy: "open",
    post_policy: "anyone",
    member_count: 1,
    created_by: "https://example.com/ap/users/owner",
    created_at: "2026-01-01T00:00:00.000Z",
    is_member: true,
    member_role: "member",
    ...overrides,
  };
}

test("communityToScope projects a joined community", () => {
  const scope = communityToScope(
    makeCommunity({ icon_url: "https://cdn/icon.png", member_role: "owner" }),
  );
  assertEquals(scope, {
    kind: "community",
    ap_id: "https://example.com/ap/communities/garden",
    name: "garden",
    display_name: "The Garden",
    icon_url: "https://cdn/icon.png",
    member_role: "owner",
  });
});

test("communityToScope returns null when not a member", () => {
  assertEquals(
    communityToScope(makeCommunity({ is_member: false, member_role: null })),
    null,
  );
});

test("communityToScope returns null when role is unknown", () => {
  assertEquals(
    communityToScope(makeCommunity({ is_member: true, member_role: null })),
    null,
  );
});

test("communityToScope normalizes null icon to undefined", () => {
  const scope = communityToScope(makeCommunity({ icon_url: null }));
  assertEquals(scope?.icon_url, undefined);
});

test("reconcileScope keeps personal scope untouched", () => {
  assertEquals(reconcileScope(PERSONAL_SCOPE, []), PERSONAL_SCOPE);
  assertEquals(
    reconcileScope(PERSONAL_SCOPE, [makeCommunity()]),
    PERSONAL_SCOPE,
  );
});

test("reconcileScope keeps a still-joined community and refreshes its label", () => {
  const stored: InhabitedScope = {
    kind: "community",
    ap_id: "https://example.com/ap/communities/garden",
    name: "garden",
    display_name: "Old Name",
    member_role: "member",
  };
  const reconciled = reconcileScope(stored, [
    makeCommunity({ display_name: "The Garden", member_role: "moderator" }),
  ]);
  assertEquals(reconciled, {
    kind: "community",
    ap_id: "https://example.com/ap/communities/garden",
    name: "garden",
    display_name: "The Garden",
    icon_url: undefined,
    member_role: "moderator",
  });
});

test("reconcileScope falls back to personal when the community is gone", () => {
  const stored: InhabitedScope = {
    kind: "community",
    ap_id: "https://example.com/ap/communities/garden",
    name: "garden",
    display_name: "The Garden",
    member_role: "member",
  };
  assertEquals(reconcileScope(stored, []), PERSONAL_SCOPE);
});

test("reconcileScope falls back to personal when membership was lost", () => {
  const stored: InhabitedScope = {
    kind: "community",
    ap_id: "https://example.com/ap/communities/garden",
    name: "garden",
    display_name: "The Garden",
    member_role: "member",
  };
  const reconciled = reconcileScope(stored, [
    makeCommunity({ is_member: false, member_role: null }),
  ]);
  assertEquals(reconciled, PERSONAL_SCOPE);
});

test("scopeToQuery returns undefined for personal", () => {
  assertEquals(scopeToQuery(PERSONAL_SCOPE), undefined);
});

test("scopeToQuery filters by community ap_id", () => {
  assertEquals(
    scopeToQuery({
      kind: "community",
      ap_id: "https://example.com/ap/communities/garden",
      name: "garden",
      display_name: "The Garden",
      member_role: "member",
    }),
    { community: "https://example.com/ap/communities/garden" },
  );
});

test("deriveMyScopes lists personal first then joined communities", () => {
  const scopes = deriveMyScopes([
    makeCommunity({
      ap_id: "https://example.com/ap/communities/garden",
      name: "garden",
      display_name: "The Garden",
    }),
    makeCommunity({
      ap_id: "https://example.com/ap/communities/forge",
      name: "forge",
      display_name: "The Forge",
      member_role: "owner",
    }),
  ]);
  assertEquals(scopes, [
    PERSONAL_SCOPE,
    {
      kind: "community",
      ap_id: "https://example.com/ap/communities/garden",
      name: "garden",
      display_name: "The Garden",
      icon_url: undefined,
      member_role: "member",
    },
    {
      kind: "community",
      ap_id: "https://example.com/ap/communities/forge",
      name: "forge",
      display_name: "The Forge",
      icon_url: undefined,
      member_role: "owner",
    },
  ]);
});

test("deriveMyScopes excludes non-member communities", () => {
  const scopes = deriveMyScopes([
    makeCommunity({ is_member: false, member_role: null }),
  ]);
  assertEquals(scopes, [PERSONAL_SCOPE]);
});

const communityScope = (apId: string): InhabitedScope => ({
  kind: "community",
  ap_id: apId,
  name: "x",
  display_name: "X",
  member_role: "member",
});

// Audit #9 finding #1: leaving a community must clear the home filter if it was
// narrowed to that community (otherwise home stays filtered to a community the
// user is no longer in, until reload). The picker refetch fails harmlessly in
// this test environment (no server) and is caught; the reset decision below is
// what we assert.
test("leaveCommunityScopeAtom resets the home filter when it was the left community", async () => {
  const store = createStore();
  store.set(inhabitedScopeAtom, communityScope("X"));
  await store.set(leaveCommunityScopeAtom, "X");
  assertEquals(store.get(inhabitedScopeAtom), PERSONAL_SCOPE);
});

test("leaveCommunityScopeAtom leaves the home filter alone when a DIFFERENT community is active", async () => {
  const store = createStore();
  const other = communityScope("Y");
  store.set(inhabitedScopeAtom, other);
  await store.set(leaveCommunityScopeAtom, "X");
  assertEquals(store.get(inhabitedScopeAtom), other);
});

test("leaveCommunityScopeAtom is a no-op for the personal (unfiltered) home", async () => {
  const store = createStore();
  await store.set(leaveCommunityScopeAtom, "X");
  assertEquals(store.get(inhabitedScopeAtom), PERSONAL_SCOPE);
});
