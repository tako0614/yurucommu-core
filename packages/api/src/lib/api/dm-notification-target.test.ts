import { afterEach, expect, test } from "bun:test";
import { fetchDMNotificationTarget } from "./dm.ts";
import { clearYurucommuApiTransport } from "../transport.ts";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  clearYurucommuApiTransport();
});
const event = "https://remote.example/activities/create?opaque=one";
const target = {
  event_id: event,
  recipient_ap_id: "https://local.example/users/me",
  target: { type: "user" as const, ap_id: "https://remote.example/users/peer" },
};

test("notification resolution carries exact event/object ids and caller read options", async () => {
  const abort = new AbortController();
  let calls = 0;
  globalThis.fetch = (async (input, init) => {
    calls += 1;
    const url = new URL(String(input), "https://local.example");
    expect(url.pathname).toBe("/api/dm/notification-target");
    expect(url.searchParams.get("event_id")).toBe(event);
    expect(url.searchParams.get("object_id")).toBe(
      "https://remote.example/objects/one",
    );
    expect(init?.signal).toBe(abort.signal);
    expect(init?.method ?? "GET").toBe("GET");
    return Response.json(target);
  }) as typeof fetch;
  expect(
    await fetchDMNotificationTarget(event, {
      objectId: "https://remote.example/objects/one",
      signal: abort.signal,
      timeoutMs: 0,
    }),
  ).toEqual(target);
  expect(calls).toBe(1);
});

test("unavailable returns null, genuine rejection is preserved, and neither retries", async () => {
  for (const status of [404, 401, 403, 503]) {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return Response.json({ error: "unavailable" }, { status });
    }) as unknown as typeof fetch;
    if (status === 404)
      expect(await fetchDMNotificationTarget(event)).toBeNull();
    else
      await expect(fetchDMNotificationTarget(event)).rejects.toMatchObject({
        name: "ApiError",
        status,
      });
    expect(calls).toBe(1);
  }
});

test("malformed identities and wrong event echoes never become navigation targets", async () => {
  for (const body of [
    {},
    { ...target, event_id: "different" },
    { ...target, recipient_ap_id: "" },
    { ...target, target: { type: "post", ap_id: "x" } },
    { ...target, target: { type: "user", ap_id: "" } },
    { ...target, target: { type: "community", ap_id: 9 } },
    { ...target, recipient_ap_id: "x".repeat(2049) },
  ]) {
    globalThis.fetch = (async () =>
      Response.json(body)) as unknown as typeof fetch;
    await expect(fetchDMNotificationTarget(event)).rejects.toMatchObject({
      name: "InvalidApiResponseError",
    });
  }
});

test("invalid outgoing ids fail before transport", async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return Response.json(target);
  }) as unknown as typeof fetch;
  for (const value of ["", " a", "a\n", "x".repeat(2049)]) {
    await expect(fetchDMNotificationTarget(value)).rejects.toBeInstanceOf(
      TypeError,
    );
    await expect(
      fetchDMNotificationTarget(event, { objectId: value }),
    ).rejects.toBeInstanceOf(TypeError);
  }
  expect(calls).toBe(0);
});
