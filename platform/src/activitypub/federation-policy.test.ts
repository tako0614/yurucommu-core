import { describe, expect, it } from "vitest";
import { applyFederationPolicy, buildActivityPubPolicy } from "./federation-policy.js";

describe("federation-policy", () => {
  it("merges takos-config and env blocklists", () => {
    const policy = buildActivityPubPolicy({
      config: { blocked_instances: ["Spam.Example", "other.example"] },
      env: { AP_BLOCKLIST: "env.example,spam.example" },
    });

    expect(policy.blocked).toEqual(["spam.example", "other.example", "env.example"]);
  });

  it("blocks hosts listed in policy (subdomain aware)", () => {
    const policy = buildActivityPubPolicy({
      config: { blocked_instances: ["blocked.example"] },
    });

    const result = applyFederationPolicy("https://sub.blocked.example/users/alice", policy);

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("blocked");
    expect(result.hostname).toBe("sub.blocked.example");
  });

  it("enforces allowlist when present", () => {
    const policy = buildActivityPubPolicy({
      env: { AP_ALLOWLIST: "friends.example" },
    });

    const rejected = applyFederationPolicy("https://other.example/users/bob", policy);
    const allowed = applyFederationPolicy("https://friends.example/users/bob", policy);

    expect(rejected.allowed).toBe(false);
    expect(rejected.reason).toBe("allowlist");
    expect(allowed.allowed).toBe(true);
  });
});
