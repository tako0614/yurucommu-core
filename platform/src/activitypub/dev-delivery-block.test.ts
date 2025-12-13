import { afterEach, describe, expect, it, vi } from "vitest";
import * as dataFactory from "../server/data-factory.js";
import { enqueueDeliveriesToFollowers } from "../utils/utils.js";
import * as deliveryWorker from "./delivery-worker.js";
import { deliverActivity } from "./delivery.js";
import { enqueueActivity } from "./outbox.js";

const originalFetch = globalThis.fetch;
const devEnv = { TAKOS_CONTEXT: "dev" };

afterEach(() => {
  vi.restoreAllMocks();
  (globalThis as any).fetch = originalFetch;
});

describe("ActivityPub delivery suppression in dev context", () => {
  it("short-circuits worker queues before touching the database", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const makeDataSpy = vi.spyOn(dataFactory, "makeData");

    await enqueueActivity(devEnv as any, {
      id: "activity-1",
      type: "Create",
      actor: "https://example.com/ap/users/alice",
      to: ["https://remote.example/ap/users/bob"],
      object: {
        id: "note-1",
        type: "Note",
        content: "hello",
      },
    });
    await deliveryWorker.processDeliveryQueue(devEnv as any);
    await deliveryWorker.deliverSingleQueuedItem(devEnv as any, "delivery-1");

    expect(makeDataSpy).not.toHaveBeenCalled();

    const warnings = warnSpy.mock.calls.flat().filter((arg) => typeof arg === "string");
    expect(warnings.some((msg) => msg.includes("outbox enqueue skipped in dev context"))).toBe(true);
    expect(warnings.some((msg) => msg.includes("delivery queue skipped in dev context"))).toBe(
      true,
    );
    expect(warnings.some((msg) => msg.includes("immediate delivery skipped in dev context"))).toBe(
      true,
    );
  });

  it("blocks follower fanout immediately in dev context", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const deliverSpy = vi.spyOn(deliveryWorker, "deliverSingleQueuedItem");
    const store = {
      query: vi.fn(),
      disconnect: vi.fn(),
    };

    await enqueueDeliveriesToFollowers(store as any, "alice", "activity-123", {
      env: devEnv,
      immediateThreshold: 1,
    });

    expect(store.query).not.toHaveBeenCalled();
    expect(deliverSpy).not.toHaveBeenCalled();
    expect(
      warnSpy.mock.calls.some((args) =>
        args.some(
          (arg) =>
            typeof arg === "string" &&
            arg.includes("[ActivityPub] follower delivery skipped in dev context"),
        ),
      ),
    ).toBe(true);
  });

  it("prevents direct ActivityPub HTTP delivery in dev context", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchSpy = vi.fn(() => {
      throw new Error("fetch should not be called in dev context");
    });
    (globalThis as any).fetch = fetchSpy as any;

    await deliverActivity(
      devEnv as any,
      {
        actor: "https://example.com/ap/users/alice",
        to: ["https://remote.example/ap/users/bob"],
        type: "Create",
      },
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(
      warnSpy.mock.calls.some((args) =>
        args.some(
          (arg) =>
            typeof arg === "string" &&
            arg.includes("[ActivityPub] deliverActivity skipped in dev context"),
        ),
      ),
    ).toBe(true);
  });
});
