import { describe, expect, it } from "vitest";
import {
  getActivityPubAvailability,
  getExecutionContext,
  isActivityPubEnabled,
} from "./context";

describe("execution context guard", () => {
  it("defaults to prod with ActivityPub enabled", () => {
    const context = getExecutionContext({});
    const availability = getActivityPubAvailability({});

    expect(context).toBe("prod");
    expect(availability.enabled).toBe(true);
    expect(isActivityPubEnabled({})).toBe(true);
  });

  it("treats dev-like values as dev context", () => {
    const env = { TAKOS_CONTEXT: "dev" };
    const context = getExecutionContext(env);
    const availability = getActivityPubAvailability(env);

    expect(context).toBe("dev");
    expect(availability.enabled).toBe(false);
    expect(availability.reason).toMatch(/dev context/i);
  });

  it("disables ActivityPub when ACTIVITYPUB_ENABLED is false", () => {
    const env = { ACTIVITYPUB_ENABLED: "false" };
    const availability = getActivityPubAvailability(env);

    expect(availability.enabled).toBe(false);
    expect(availability.reason).toMatch(/disabled by ACTIVITYPUB_ENABLED/i);
  });
});
