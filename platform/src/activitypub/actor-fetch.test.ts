import { beforeEach, describe, expect, it, vi } from "vitest";
import { getOrFetchActor } from "./actor-fetch.js";
import { setDataFactory } from "../server/data-factory.js";

describe("getOrFetchActor in dev context", () => {
  const actorUri = "https://remote.example/users/alice";
  const fetcher = vi.fn();
  let db: any;

  beforeEach(() => {
    db = {
      findApActor: vi.fn(),
      upsertApActor: vi.fn(),
      disconnect: vi.fn(),
    };
    fetcher.mockReset();
    setDataFactory(() => db);
  });

  it("returns cached actor without remote fetch when AP is disabled", async () => {
    const cachedRow = {
      id: actorUri,
      handle: "alice",
      type: "Person",
      display_name: "Alice",
      inbox_url: `${actorUri}/inbox`,
      outbox_url: `${actorUri}/outbox`,
      last_fetched_at: new Date(),
    };
    db.findApActor.mockResolvedValue(cachedRow);

    const result = await getOrFetchActor(
      actorUri,
      { DB: {} as any, TAKOS_CONTEXT: "dev" } as any,
      false,
      fetcher,
    );

    expect(fetcher).not.toHaveBeenCalled();
    expect(db.upsertApActor).not.toHaveBeenCalled();
    expect(result?.id).toBe(actorUri);
  });

  it("skips remote fetch entirely when AP is disabled and no cache exists", async () => {
    db.findApActor.mockResolvedValue(null);

    const result = await getOrFetchActor(
      actorUri,
      { DB: {} as any, TAKOS_CONTEXT: "dev" } as any,
      true,
      fetcher,
    );

    expect(result).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    expect(db.upsertApActor).not.toHaveBeenCalled();
  });
});
