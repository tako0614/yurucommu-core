import { afterEach, expect, test } from "bun:test";
import {
  fetchOwnedDMMessage,
  editOwnedDMMessage,
  deleteOwnedDMMessage,
} from "./dm.ts";
import { clearYurucommuApiTransport } from "../transport.ts";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  clearYurucommuApiTransport();
});
const id = "https://local.example/objects/opaque%2Fone?value=%25",
  revision = "dm-v1:" + "a".repeat(64);
const message = {
  id,
  content: "Original",
  created_at: null,
  sender: {
    ap_id: "https://local.example/users/me",
    username: "me",
    preferred_username: "me",
    name: null,
    icon_url: null,
  },
};

test("owned reader preserves opaque identity/read options and distinguishes true absence from unsupported host", async () => {
  let status = 200,
    body: unknown = { message, revision };
  const abort = new AbortController();
  globalThis.fetch = (async (input, init) => {
    expect(String(input)).toContain(encodeURIComponent(id));
    expect(init?.signal).toBe(abort.signal);
    return Response.json(body, { status });
  }) as typeof fetch;
  expect(
    (await fetchOwnedDMMessage(id, { signal: abort.signal, timeoutMs: 0 }))
      ?.revision,
  ).toBe(revision);
  status = 404;
  body = { error: "owned_dm_not_found", code: "owned_dm_not_found" };
  expect(
    await fetchOwnedDMMessage(id, { signal: abort.signal, timeoutMs: 0 }),
  ).toBeNull();
  body = { error: "unknown route" };
  await expect(
    fetchOwnedDMMessage(id, { signal: abort.signal, timeoutMs: 0 }),
  ).rejects.toMatchObject({ status: 404 });
});

test("mutations carry exact revision and require real ACKs without retrying", async () => {
  const calls: string[] = [];
  let failed = false;
  globalThis.fetch = (async (_input, init) => {
    calls.push(init!.method!);
    if (init?.method === "PATCH")
      expect(new Headers(init.headers).get("content-type")).toBe(
        "application/json",
      );
    expect(new Headers(init?.headers).get("if-match")).toBe(
      JSON.stringify(revision),
    );
    if (failed)
      return Response.json({ error: "message_changed" }, { status: 409 });
    return Response.json(
      init?.method === "PATCH"
        ? {
            success: true,
            message: {
              id,
              content: "Edited",
              updated_at: "2026-11-05T00:00:01Z",
            },
            revision,
          }
        : { success: true },
    );
  }) as typeof fetch;
  expect((await editOwnedDMMessage(id, " Edited ", revision)).content).toBe(
    "Edited",
  );
  await deleteOwnedDMMessage(id, revision);
  failed = true;
  await expect(
    editOwnedDMMessage(id, "Edited", revision),
  ).rejects.toMatchObject({ status: 409 });
  await expect(deleteOwnedDMMessage(id, revision)).rejects.toMatchObject({
    status: 409,
  });
  expect(calls).toEqual(["PATCH", "DELETE", "PATCH", "DELETE"]);
});

test("wrong targets, malformed ACKs and unversioned writes fail closed", async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return Response.json({
      message: { ...message, id: "wrong" },
      revision,
      success: true,
    });
  }) as unknown as typeof fetch;
  await expect(fetchOwnedDMMessage(id)).rejects.toMatchObject({
    name: "InvalidApiResponseError",
  });
  await expect(editOwnedDMMessage(id, "Edit", revision)).rejects.toMatchObject({
    name: "InvalidApiResponseError",
  });
  const before = calls;
  await expect(deleteOwnedDMMessage(id, "*")).rejects.toMatchObject({
    name: "InvalidApiResponseError",
  });
  await expect(editOwnedDMMessage(id, " ", revision)).rejects.toBeInstanceOf(
    TypeError,
  );
  expect(calls).toBe(before);
});
