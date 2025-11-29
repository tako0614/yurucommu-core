import { describe, expect, it } from "vitest";
import { parseActorToUserId } from "./users";

describe("parseActorToUserId", () => {
  it("returns local handle when instance domain includes port", () => {
    const actorUri = "https://localhost:8787/ap/users/alice";
    const result = parseActorToUserId(actorUri, "localhost:8787");
    expect(result).toBe("alice");
  });

  it("returns local handle when instance domain omits port", () => {
    const actorUri = "https://localhost:8787/ap/users/bob";
    const result = parseActorToUserId(actorUri, "localhost");
    expect(result).toBe("bob");
  });

  it("falls back to federated handle for remote actors", () => {
    const actorUri = "https://remote.example.com/ap/users/carol";
    const result = parseActorToUserId(actorUri, "example.com");
    expect(result).toBe("@carol@remote.example.com");
  });
});
