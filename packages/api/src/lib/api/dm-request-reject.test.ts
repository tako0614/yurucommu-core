import { afterEach, expect, test } from "bun:test";
import { rejectPendingDMRequest } from "./dm.ts";
import { clearYurucommuApiTransport } from "../transport.ts";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  clearYurucommuApiTransport();
});
const sender = "https://peer.example/users/opaque?one=two";

test("strict pending rejection sends the exact peer and requires an actual ACK", async () => {
  let body: unknown = { success: true };
  globalThis.fetch = (async (input, init) => {
    expect(new URL(String(input), "https://local.example").pathname).toBe(
      "/api/dm/requests/reject-pending",
    );
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      sender_ap_id: sender,
      block: false,
    });
    return Response.json(body);
  }) as typeof fetch;
  await rejectPendingDMRequest(sender);
  body = { success: false };
  await expect(rejectPendingDMRequest(sender)).rejects.toMatchObject({
    name: "InvalidApiResponseError",
  });
});

test("old hosts, conflicts and failures never fall back to legacy deletion or retry", async () => {
  for (const status of [404, 409, 401, 503]) {
    let calls = 0;
    globalThis.fetch = (async (input) => {
      calls += 1;
      expect(new URL(String(input), "https://local.example").pathname).toBe(
        "/api/dm/requests/reject-pending",
      );
      return Response.json({ error: "not available" }, { status });
    }) as typeof fetch;
    await expect(rejectPendingDMRequest(sender)).rejects.toMatchObject({
      name: "ApiError",
      status,
    });
    expect(calls).toBe(1);
  }
});

test("invalid peer identifiers do not reach a mutation transport", async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return Response.json({ success: true });
  }) as unknown as typeof fetch;
  for (const value of ["", " a", "a\n", "x".repeat(2049)])
    await expect(rejectPendingDMRequest(value)).rejects.toBeInstanceOf(
      TypeError,
    );
  expect(calls).toBe(0);
});
