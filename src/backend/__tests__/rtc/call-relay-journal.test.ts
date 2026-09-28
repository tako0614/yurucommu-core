import { expect, test } from "bun:test";
import { CallRelayJournal } from "../../runtime/call-relay-journal.ts";
import {
  CALL_RELAY_MAX_PENDING,
  callRelayResult,
  parseCallRelayEffect,
} from "../../runtime/call-relay.ts";
import type { DeferredCallRelay } from "../../runtime/call-hub-core.ts";
import type { OneTimeTicketStorage } from "../../runtime/one-time-ticket.ts";

function fixture() {
  const rows = new Map<string, unknown>();
  const storage: OneTimeTicketStorage = {
    get: async <T>(key: string) => rows.get(key) as T | undefined,
    put: async (key, value) => {
      rows.set(key, structuredClone(value));
    },
    delete: async (key) => rows.delete(key),
    list: async <T>({ prefix }: { prefix: string }) =>
      new Map(
        [...rows]
          .filter(([key]) => key.startsWith(prefix))
          .map(([key, value]) => [key, structuredClone(value) as T]),
      ),
  };
  const relay: DeferredCallRelay = {
    call: {
      callId: "one",
      peerApId: "https://peer.example/bob",
      direction: "outgoing",
      state: "connecting",
      media: { audio: true, video: false },
      sfuFocus: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      generation: crypto.randomUUID(),
    },
    envelope: {
      v: 1,
      type: "offer",
      callId: "one",
      from: "https://local.example/alice",
      to: "https://peer.example/bob",
      sdp: "never persist this SDP",
      ts: Date.now(),
      ttlMs: 30000,
    },
    continuation: "none",
  };
  return { rows, relay, journal: new CallRelayJournal(storage) };
}

test("relay journal has bounded allowlisted metadata and refuses the 65th pending effect", async () => {
  const { rows, relay, journal } = fixture();
  for (let n = 0; n < CALL_RELAY_MAX_PENDING; n++) await journal.prepare(relay);
  await expect(journal.prepare(relay)).rejects.toThrow("capacity");
  expect(rows.size).toBe(CALL_RELAY_MAX_PENDING);
  expect(JSON.stringify([...rows.values()])).not.toContain(
    "never persist this SDP",
  );
  const effect = [...rows.values()][0] as object;
  expect(
    parseCallRelayEffect({ ...effect, sdp: "discarded" }),
  ).not.toHaveProperty("sdp");
  expect(parseCallRelayEffect({ ...effect, ingressDigest: "bad" })).toBeNull();
});

test("relay journal matches all correlation fields and consumption is one-use", async () => {
  const { relay, journal } = fixture();
  const { effect } = await journal.prepare(relay);
  const result = callRelayResult(effect, "peer_ack");
  for (const patch of [
    { effectId: crypto.randomUUID() },
    { generation: crypto.randomUUID() },
    { callId: "another" },
    { deadline: result.deadline + 1 },
  ]) {
    expect(await journal.lookup({ ...result, ...patch })).toBeNull();
  }
  expect(await journal.lookup(result)).toEqual(effect);
  await journal.remove(effect);
  expect(await journal.lookup(result)).toBeNull();
});
