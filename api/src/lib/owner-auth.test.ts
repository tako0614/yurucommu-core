import { describe, expect, it } from "vitest";
import {
  isOwnerUser,
  normalizeHandle,
  resolveOwnerHandle,
  selectActiveUser,
  buildOwnerActorValidator,
} from "./owner-auth";

const buildEnv = (overrides: Record<string, unknown> = {}) =>
  ({
    INSTANCE_OWNER_HANDLE: "owner",
    AUTH_USERNAME: "legacy",
    ...overrides,
  }) as any;

describe("owner auth helpers", () => {
  it("resolves owner handle with precedence over legacy username", () => {
    expect(resolveOwnerHandle(buildEnv({ INSTANCE_OWNER_HANDLE: "Root" }))).toBe("root");
    expect(resolveOwnerHandle(buildEnv({ INSTANCE_OWNER_HANDLE: "" }))).toBe("legacy");
    expect(resolveOwnerHandle(buildEnv({ INSTANCE_OWNER_HANDLE: "", AUTH_USERNAME: "" }))).toBe(
      "owner",
    );
  });

  it("detects owner user by handle", () => {
    const env = buildEnv({ INSTANCE_OWNER_HANDLE: "root" });
    expect(isOwnerUser({ id: "root" }, env)).toBe(true);
    expect(isOwnerUser({ id: "ROOT" }, env)).toBe(true);
    expect(isOwnerUser({ id: "someone" }, env)).toBe(false);
  });

  it("selectActiveUser blocks impersonation unless base user is the owner and owns the actor", async () => {
    const env = buildEnv({ INSTANCE_OWNER_HANDLE: "root" });
    const baseUser = { id: "root" };
    const ownedUser = { id: "alice", owner_id: "root" };
    const otherUser = { id: "bob" };
    const fetchUser = async (id: string) => {
      if (id === "alice") return ownedUser;
      if (id === "bob") return otherUser;
      return null;
    };

    const unchanged = await selectActiveUser(null, baseUser, env, fetchUser);
    expect(unchanged).toEqual({ user: baseUser, activeUserId: "root" });

    const invalid = await selectActiveUser("!!", baseUser, env, fetchUser);
    expect(invalid.activeUserId).toBe("root");

    const switched = await selectActiveUser("alice", baseUser, env, fetchUser);
    expect(switched.user).toBe(ownedUser);
    expect(switched.activeUserId).toBe("alice");

    const rejected = await selectActiveUser("bob", baseUser, env, fetchUser);
    expect(rejected.activeUserId).toBe("root");

    const nonOwner = await selectActiveUser("alice", { id: "bob" }, env, fetchUser);
    expect(nonOwner.activeUserId).toBe("bob");
  });

  it("accepts owner-owned actors when mapped via owner accounts", async () => {
    const env = buildEnv({ INSTANCE_OWNER_HANDLE: "root" });
    const baseUser = { id: "root" };
    const fetchUser = async (id: string) => ({ id });
    const validator = buildOwnerActorValidator(async (userId: string) => {
      if (userId === "carol") {
        return [{ provider: "owner", provider_account_id: "root:carol" }];
      }
      return [];
    });

    const owned = await selectActiveUser("carol", baseUser, env, fetchUser, validator);
    expect(owned.activeUserId).toBe("carol");

    const rejected = await selectActiveUser("dave", baseUser, env, fetchUser, validator);
    expect(rejected.activeUserId).toBe("root");
  });

  it("normalizes handles consistently", () => {
    expect(normalizeHandle("  Alice ")).toBe("alice");
    expect(normalizeHandle("")).toBe("");
  });
});
