import { assertEquals } from "#test/assert";
import { test } from "bun:test";
import type { CommunityDetail } from "../lib/api/communities.ts";
import {
  communityToScope,
  deriveMyScopes,
  type InhabitedScope,
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
