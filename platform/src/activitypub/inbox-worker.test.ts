import { afterEach, describe, expect, it, vi } from "vitest";
import * as chat from "./chat.js";
import * as objectService from "../app/services/object-service.js";
import { _test } from "./inbox-worker.js";

const { processActivity } = _test;

function makeDb() {
  return {
    findPostByApObjectId: vi.fn(),
    findApAnnounce: vi.fn(),
    createApAnnounce: vi.fn(),
    deleteApAnnouncesByActivityId: vi.fn(),
    deleteApFollowers: vi.fn(),
    deleteApReactionsByActivityId: vi.fn(),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("inbox-worker Announce/Undo", () => {
  const env = { INSTANCE_DOMAIN: "example.com" };
  const localPostUri = "https://example.com/ap/objects/post-1";
  const remoteActor = "https://remote.example/users/bob";

  it("stores Announce for a local post and skips duplicates", async () => {
    const db = makeDb();
    db.findPostByApObjectId.mockResolvedValue({ id: "post-1" });
    db.findApAnnounce
      .mockResolvedValueOnce(null) // first time: new
      .mockResolvedValueOnce({ id: "existing" }); // second time: duplicate

    await processActivity(
      db as any,
      env as any,
      "alice",
      {
        type: "Announce",
        id: "https://remote.example/activities/announce-1",
        actor: remoteActor,
        object: localPostUri,
      },
    );

    expect(db.createApAnnounce).toHaveBeenCalledWith({
      activity_id: "https://remote.example/activities/announce-1",
      actor_id: remoteActor,
      object_id: localPostUri,
      local_post_id: "post-1",
    });

    // Second attempt should be idempotent
    await processActivity(
      db as any,
      env as any,
      "alice",
      {
        type: "Announce",
        id: "https://remote.example/activities/announce-1",
        actor: remoteActor,
        object: localPostUri,
      },
    );

    expect(db.createApAnnounce).toHaveBeenCalledTimes(1);
  });

  it("handles Undo Announce by deleting the stored boost", async () => {
    const db = makeDb();

    await processActivity(
      db as any,
      env as any,
      "alice",
      {
        type: "Undo",
        actor: remoteActor,
        object: {
          type: "Announce",
          id: "https://remote.example/activities/announce-1",
        },
      },
    );

    expect(db.deleteApAnnouncesByActivityId).toHaveBeenCalledWith(
      "https://remote.example/activities/announce-1",
    );
  });

  it("blocks Announce from blocklisted domains", async () => {
    const db = makeDb();
    const blockedEnv = { ...env, AP_BLOCKLIST: "remote.example" };

    await processActivity(
      db as any,
      blockedEnv as any,
      "alice",
      {
        type: "Announce",
        id: "https://remote.example/activities/announce-1",
        actor: remoteActor,
        object: localPostUri,
      },
    );

    expect(db.findPostByApObjectId).not.toHaveBeenCalled();
    expect(db.createApAnnounce).not.toHaveBeenCalled();
  });

  it("blocks Announce when takos-config lists the instance", async () => {
    const db = makeDb();
    const configEnv = {
      ...env,
      takosConfig: { activitypub: { blocked_instances: ["remote.example"] } },
    };

    await processActivity(
      db as any,
      configEnv as any,
      "alice",
      {
        type: "Announce",
        id: "https://remote.example/activities/announce-1",
        actor: remoteActor,
        object: localPostUri,
      },
    );

    expect(db.findPostByApObjectId).not.toHaveBeenCalled();
    expect(db.createApAnnounce).not.toHaveBeenCalled();
  });

  it("rejects Announce when allowlist is set and domain not allowed", async () => {
    const db = makeDb();
    const allowEnv = { ...env, AP_ALLOWLIST: "friends.example" };

    await processActivity(
      db as any,
      allowEnv as any,
      "alice",
      {
        type: "Announce",
        id: "https://remote.example/activities/announce-1",
        actor: remoteActor,
        object: localPostUri,
      },
    );

    expect(db.findPostByApObjectId).not.toHaveBeenCalled();
    expect(db.createApAnnounce).not.toHaveBeenCalled();
  });
});

describe("inbox-worker direct messages", () => {
  const env = { INSTANCE_DOMAIN: "example.com" };

  it("routes Create activities with only bto/bcc to DM handler", async () => {
    const db = makeDb();
    const dmSpy = vi.spyOn(chat, "handleIncomingDm").mockResolvedValue(undefined as any);

    await processActivity(
      db as any,
      env as any,
      "bob",
      {
        type: "Create",
        actor: "https://remote.example/users/alice",
        object: {
          type: "Note",
          content: "hi",
          bto: ["https://example.com/ap/users/bob"],
        },
      },
    );

    expect(dmSpy).toHaveBeenCalledTimes(1);
  });

  it("normalizes incoming DM recipients and stores as direct", async () => {
    const receiveRemote = vi.fn().mockResolvedValue({});
    vi.spyOn(objectService, "createObjectService").mockReturnValue({ receiveRemote } as any);

    await chat.handleIncomingDm(env as any, {
      actor: "https://remote.example/users/alice",
      object: {
        type: "Note",
        id: "note-1",
        content: "<script>bad()</script><p>ok</p>",
        to: ["https://www.w3.org/ns/activitystreams#Public"],
        bto: ["https://example.com/ap/users/bob"],
        bcc: ["https://example.com/ap/users/charlie"],
      },
    } as any);

    expect(receiveRemote).toHaveBeenCalledTimes(1);
    const payload = receiveRemote.mock.calls[0][1];
    expect(payload.visibility).toBe("direct");
    expect(payload.actor).toBe("https://remote.example/users/alice");
    expect(payload.to).toEqual([]);
    expect(payload.bto).toEqual(["https://example.com/ap/users/bob"]);
    expect(payload.bcc).toEqual(["https://example.com/ap/users/charlie"]);
    expect(payload.content).toBe("<p>ok</p>");
  });
});
