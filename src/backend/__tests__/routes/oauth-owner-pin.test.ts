import { expect, test } from "bun:test";

/**
 * Owner-slot protection for OAuth/OIDC login.
 *
 * yurucommu is single-tenant: the FIRST actor created becomes `owner`. On an
 * OIDC-seeded Capsule a third party who can obtain a valid token for the
 * materialized client could otherwise race the operator for that slot. When
 * `OIDC_OWNER_SUB` pins the operator's subject, only that subject may take the
 * owner slot; any other first-login is REFUSED (returns null, not downgraded to
 * member — downgrading would consume the owner slot and lock the operator out).
 * With no pin set, an explicit one-time opt-in is required.
 */

import type { Database } from "../../../db/index.ts";
import { actors } from "../../../db/index.ts";
import type { Env } from "../../types.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";
import {
  createActorFromOAuth,
  type VerifiedTakosumiAppGrant,
} from "../../routes/auth-helpers.ts";
import type { TakosumiWorkspaceRole } from "../../lib/oidc-id-token.ts";

const APP_URL = "https://yuru.test";
async function freshDb(): Promise<Database> {
  return (await createTestDb()).db;
}

function envWith(extra: Partial<Env>): Env {
  return { APP_URL, ...extra } as unknown as Env;
}

const userInfo = (id: string) => ({
  id,
  name: "Operator",
  username: "operator",
});

// Legacy (compat) grant: only the Workspace claims, no per-app role.
const takosumiGrant = (
  role: TakosumiWorkspaceRole,
): VerifiedTakosumiAppGrant => ({
  capsuleId: "cap_yurucommu",
  workspace: { workspaceId: "ws_yurucommu", role },
});

// Grant shape Takosumi Accounts emits since the 2026-10-29 per-app rollout.
const takosumiAppGrant = (
  appRole: VerifiedTakosumiAppGrant["appRole"],
  workspaceRole?: TakosumiWorkspaceRole,
): VerifiedTakosumiAppGrant => ({
  capsuleId: "cap_yurucommu",
  ...(appRole ? { appRole } : {}),
  ...(workspaceRole
    ? { workspace: { workspaceId: "ws_yurucommu", role: workspaceRole } }
    : {}),
});

test("no owner pin and no bootstrap opt-in: first OAuth login is refused", async () => {
  const db = await freshDb();
  const actor = await createActorFromOAuth(
    db,
    envWith({}),
    userInfo("sub-anyone"),
    "sub-anyone",
  );
  expect(actor).toBeNull();
  expect(await db.select().from(actors).all()).toHaveLength(0);
});

test("ALLOW_UNPINNED_OWNER_CLAIM permits one explicit bootstrap login", async () => {
  const db = await freshDb();
  const actor = await createActorFromOAuth(
    db,
    envWith({ ALLOW_UNPINNED_OWNER_CLAIM: "true" }),
    userInfo("sub-bootstrap"),
    "sub-bootstrap",
  );
  expect(actor?.role).toBe("owner");
});

test("a verified Takosumi Workspace owner claim replaces a static owner-sub pin", async () => {
  const db = await freshDb();
  const actor = await createActorFromOAuth(
    db,
    envWith({}),
    userInfo("issuer-owner"),
    "takos:issuer-owner",
    takosumiGrant("owner"),
  );
  expect(actor?.role).toBe("owner");
});

test.each(["admin", "member", "viewer"] as const)(
  "a verified Takosumi Workspace %s claim cannot take the app owner slot",
  async (role) => {
    const db = await freshDb();
    const actor = await createActorFromOAuth(
      db,
      envWith({}),
      userInfo(`issuer-${role}`),
      `takos:issuer-${role}`,
      takosumiGrant(role),
    );
    expect(actor).toBeNull();
    expect(await db.select().from(actors).all()).toHaveLength(0);
  },
);

test.each([
  ["app_role owner with Workspace claims", takosumiAppGrant("owner", "owner")],
  ["app_role owner without Workspace claims", takosumiAppGrant("owner")],
  [
    "app_role owner with a non-owner Workspace role",
    takosumiAppGrant("owner", "member"),
  ],
] as const)(
  "a verified Takosumi %s takes the owner slot on a fresh instance",
  async (_label, grant) => {
    const db = await freshDb();
    const actor = await createActorFromOAuth(
      db,
      envWith({}),
      userInfo("issuer-app-owner"),
      "takos:issuer-app-owner",
      grant,
    );
    expect(actor?.role).toBe("owner");
    expect(await db.select().from(actors).all()).toHaveLength(1);
  },
);

test.each([
  ["app_role member", takosumiAppGrant("member")],
  [
    "app_role member with a Workspace owner role",
    takosumiAppGrant("member", "owner"),
  ],
  ["capsule_id only (not an app member)", takosumiAppGrant(undefined)],
] as const)(
  "a verified Takosumi %s cannot take the app owner slot",
  async (_label, grant) => {
    const db = await freshDb();
    const actor = await createActorFromOAuth(
      db,
      envWith({}),
      userInfo("issuer-app-member"),
      "takos:issuer-app-member",
      grant,
    );
    expect(actor).toBeNull();
    expect(await db.select().from(actors).all()).toHaveLength(0);
  },
);

test("a per-app owner claim cannot authorize another OAuth provider", async () => {
  const db = await freshDb();
  const actor = await createActorFromOAuth(
    db,
    envWith({}),
    userInfo("google-owner"),
    "google:google-owner",
    takosumiAppGrant("owner"),
  );
  expect(actor).toBeNull();
  expect(await db.select().from(actors).all()).toHaveLength(0);
});

test("a per-app owner claim cannot override a non-matching OIDC_OWNER_SUB pin", async () => {
  const db = await freshDb();
  const actor = await createActorFromOAuth(
    db,
    envWith({ OIDC_OWNER_SUB: "pinned-operator" }),
    userInfo("someone-else"),
    "takos:someone-else",
    takosumiAppGrant("owner"),
  );
  expect(actor).toBeNull();
  expect(await db.select().from(actors).all()).toHaveLength(0);
});

test("a per-app owner claim does not open member provisioning once an owner exists", async () => {
  const db = await freshDb();
  const owner = await createActorFromOAuth(
    db,
    envWith({}),
    userInfo("first-owner"),
    "takos:first-owner",
    takosumiAppGrant("owner"),
  );
  expect(owner?.role).toBe("owner");
  const second = await createActorFromOAuth(
    db,
    envWith({}),
    userInfo("second-owner-claim"),
    "takos:second-owner-claim",
    takosumiAppGrant("owner"),
  );
  expect(second).toBeNull();
  expect(await db.select().from(actors).all()).toHaveLength(1);
});

test("a Takosumi-shaped claim cannot authorize another OAuth provider", async () => {
  const db = await freshDb();
  const actor = await createActorFromOAuth(
    db,
    envWith({}),
    userInfo("google-owner"),
    "google:google-owner",
    takosumiGrant("owner"),
  );
  expect(actor).toBeNull();
  expect(await db.select().from(actors).all()).toHaveLength(0);
});

test("OIDC_OWNER_SUB set: matching first login becomes owner", async () => {
  const db = await freshDb();
  const actor = await createActorFromOAuth(
    db,
    envWith({ OIDC_OWNER_SUB: "sub-operator" }),
    userInfo("sub-operator"),
    "sub-operator",
  );
  expect(actor?.role).toBe("owner");
});

test("a bare OIDC_OWNER_SUB matches the persisted provider-namespaced subject", async () => {
  const db = await freshDb();
  const actor = await createActorFromOAuth(
    db,
    envWith({ OIDC_OWNER_SUB: "issuer-sub" }),
    userInfo("issuer-sub"),
    "takos:issuer-sub",
  );
  expect(actor?.role).toBe("owner");
  expect(actor?.takosUserId).toBe("takos:issuer-sub");
});

test("OIDC_OWNER_SUB set: a non-matching first login is REFUSED (owner slot preserved)", async () => {
  const db = await freshDb();
  const refused = await createActorFromOAuth(
    db,
    envWith({ OIDC_OWNER_SUB: "sub-operator" }),
    userInfo("sub-attacker"),
    "sub-attacker",
  );
  expect(refused).toBeNull();
  // No actor row was consumed — the owner slot is still open for the operator.
  const count = (await db.select().from(actors).all()).length;
  expect(count).toBe(0);

  // …and the real operator can still claim owner afterwards.
  const owner = await createActorFromOAuth(
    db,
    envWith({ OIDC_OWNER_SUB: "sub-operator" }),
    userInfo("sub-operator"),
    "sub-operator",
  );
  expect(owner?.role).toBe("owner");
});

test("TAKOSUMI_ACCOUNTS_OWNER_SUB is honored as the pin too", async () => {
  const db = await freshDb();
  const refused = await createActorFromOAuth(
    db,
    envWith({ TAKOSUMI_ACCOUNTS_OWNER_SUB: "sub-operator" }),
    userInfo("sub-attacker"),
    "sub-attacker",
  );
  expect(refused).toBeNull();
});

// Audit #12 finding #2: member auto-provisioning is CLOSED by default on a
// single-user instance. Once the owner exists, a brand-new external subject must
// NOT be able to self-provision a member account just by completing the issuer's
// OAuth flow (on a shared issuer that would let the whole population register).
test("member auto-provisioning is CLOSED by default: a second (non-allowlisted) login is REFUSED", async () => {
  const db = await freshDb();
  await createActorFromOAuth(
    db,
    envWith({ OIDC_OWNER_SUB: "sub-operator" }),
    userInfo("sub-operator"),
    "sub-operator",
  );
  const refused = await createActorFromOAuth(
    db,
    envWith({ OIDC_OWNER_SUB: "sub-operator" }),
    { id: "sub-guest", name: "Guest", username: "guest" },
    "sub-guest",
  );
  expect(refused).toBeNull();
});

test("a second login with NO owner pin set is also refused (registration closed by default)", async () => {
  const db = await freshDb();
  await createActorFromOAuth(
    db,
    envWith({ ALLOW_UNPINNED_OWNER_CLAIM: "true" }),
    userInfo("sub-owner"),
    "sub-owner",
  );
  const refused = await createActorFromOAuth(
    db,
    envWith({}),
    { id: "sub-guest", name: "Guest", username: "guest" },
    "sub-guest",
  );
  expect(refused).toBeNull();
});

test("a subject in OIDC_ALLOWED_SUBS CAN auto-provision a member after the owner exists", async () => {
  const db = await freshDb();
  await createActorFromOAuth(
    db,
    envWith({ OIDC_OWNER_SUB: "sub-operator" }),
    userInfo("sub-operator"),
    "sub-operator",
  );
  const member = await createActorFromOAuth(
    db,
    envWith({
      OIDC_OWNER_SUB: "sub-operator",
      OIDC_ALLOWED_SUBS: "sub-other, sub-guest",
    }),
    { id: "sub-guest", name: "Guest", username: "guest" },
    "sub-guest",
  );
  expect(member?.role).toBe("member");
});

// Audit #16 #11: the OAuth/OIDC login path is the one write to actors.name /
// iconUrl that escaped the profile caps every other path enforces. A malicious /
// multi-tenant issuer must not push an unbounded display name or a
// validator-bypassing icon URL into the local row (served + federated verbatim).
test("OAuth profile: oversized name is capped to 50 and an invalid icon URL is dropped", async () => {
  const db = await freshDb();
  const actor = await createActorFromOAuth(
    db,
    envWith({ ALLOW_UNPINNED_OWNER_CLAIM: "true" }),
    {
      id: "sub-evil",
      name: "X".repeat(500),
      username: "operator",
      picture: "javascript:alert(1)",
    },
    "sub-evil",
  );
  expect(actor).toBeTruthy();
  expect(actor?.name?.length).toBe(50);
  expect(actor?.iconUrl).toBeNull();
});

test("OAuth profile: a valid https picture is accepted", async () => {
  const db = await freshDb();
  const actor = await createActorFromOAuth(
    db,
    envWith({ ALLOW_UNPINNED_OWNER_CLAIM: "true" }),
    {
      id: "sub-ok",
      name: "Operator",
      username: "operator",
      picture: "https://cdn.example/avatar.png",
    },
    "sub-ok",
  );
  expect(actor?.iconUrl).toBe("https://cdn.example/avatar.png");
});
