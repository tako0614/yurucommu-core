import { expect, test } from "bun:test";
import { createServer } from "node:http";
import type { Socket } from "node:net";
import { fetchWithTimeout } from "./fetch-with-timeout.ts";
import { apiFetch, assertOk } from "./api/fetch.ts";
import { readResponseJson } from "./api/response.ts";
import { fetchUserDMMessages } from "./api/dm.ts";
import {
  clearYurucommuApiTransport,
  setYurucommuApiTransport,
} from "./transport.ts";

async function nativeServer(run: (origin: string) => Promise<void>) {
  const sockets = new Set<Socket>();
  const server = createServer((request, response) => {
    if (request.url === "/redirect") {
      response.writeHead(302, { Location: "/empty" });
      response.end();
      return;
    }
    if (request.url === "/empty") {
      response.writeHead(204);
      response.end();
      return;
    }
    const send = () => {
      if (response.destroyed) return;
      response.writeHead(request.url?.includes("error") ? 503 : 200, {
        "Content-Type": "application/json",
      });
      response.write('{"messages":['); // headers and partial body, intentionally never complete
    };
    if (request.url === "/delayed") setTimeout(send, 40);
    else send();
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("missing listening address");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    clearYurucommuApiTransport();
  }
}

test("native fetch deadline cancels stalled JSON after delayed headers", async () => {
  await nativeServer(async (origin) => {
    const start = performance.now();
    const response = await fetchWithTimeout(`${origin}/delayed`, {
      timeoutMs: 100,
    });
    await expect(readResponseJson(response)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(performance.now() - start).toBeLessThan(350);
  });
});

test("native failed-response stalled JSON retains cancellation outcome", async () => {
  await nativeServer(async (origin) => {
    const response = await apiFetch(`${origin}/error`, { timeoutMs: 60 });
    await expect(assertOk(response, "server failed")).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});

test("native typed GET cancellation after headers preserves the caller reason", async () => {
  await nativeServer(async (origin) => {
    setYurucommuApiTransport({
      resolveUrl: (url) => origin + url,
      getAuthHeaders: () => ({}),
      credentials: "omit",
    });
    const caller = new AbortController();
    const pending = fetchUserDMMessages("alice", {
      signal: caller.signal,
      timeoutMs: 500,
    });
    // The server has sent headers/body by this point; the helper is consuming JSON.
    await Bun.sleep(50);
    const reason = new Error("view changed");
    caller.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });
});

test("native public Response keeps metadata and clone/blob deadline semantics", async () => {
  await nativeServer(async (origin) => {
    const empty = await fetchWithTimeout(`${origin}/redirect`, {
      timeoutMs: 80,
    });
    expect(empty.url).toBe(`${origin}/empty`);
    expect(empty.redirected).toBe(true);
    const native = await fetch(`${origin}/redirect`);
    expect(empty.type).toBe(native.type);
    expect(empty.body === null).toBe(native.body === null);
    expect(await empty.text()).toBe(await native.text());
    const response = await apiFetch(`${origin}/blob`, { timeoutMs: 80 });
    const clone = response.clone();
    const results = await Promise.allSettled([response.blob(), clone.text()]);
    expect(results.every((result) => result.status === "rejected")).toBe(true);
    for (const result of results)
      if (result.status === "rejected")
        expect(result.reason.name).toBe("AbortError");
  });
});

test("native no-timeout Request explicitly detached from an aborted input signal", async () => {
  await nativeServer(async (origin) => {
    const caller = new AbortController();
    caller.abort("old request");
    const input = new Request(`${origin}/empty`, { signal: caller.signal });
    const response = await fetchWithTimeout(input, {
      signal: null,
      timeoutMs: 0,
    });
    expect(response.status).toBe(204);
  });
});
