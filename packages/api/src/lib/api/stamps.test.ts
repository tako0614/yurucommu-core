import { afterEach, expect, test } from "bun:test";

import { clearYurucommuApiTransport } from "../transport.ts";
import {
  fetchStampPacks,
  installStampPack,
  setStampFavorite,
  uninstallStampPack,
} from "./stamps.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearYurucommuApiTransport();
});

test("Stamp pack helpers preserve the server wire contract", async () => {
  const requests: Array<{ url: string; method: string; body: unknown }> = [];
  globalThis.fetch = (async (input, init) => {
    requests.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (String(input).endsWith("/api/stamps/packs")) {
      return Response.json({ packs: [] });
    }
    if (String(input).endsWith("/api/stamps/install")) {
      return Response.json({
        pack_id: "https://alice.example/stamp-packs/cat",
        release_id: "r1",
      });
    }
    return Response.json({ success: true });
  }) as typeof fetch;

  const packId = "https://alice.example/stamp-packs/cat";
  expect(await fetchStampPacks()).toEqual([]);
  await installStampPack(packId);
  await uninstallStampPack(packId);
  await setStampFavorite(`${packId}/stamps/okay`, true);

  expect(requests).toEqual([
    { url: "/api/stamps/packs", method: "GET", body: undefined },
    {
      url: "/api/stamps/install",
      method: "POST",
      body: { pack_id: packId },
    },
    {
      url: "/api/stamps/install",
      method: "DELETE",
      body: { pack_id: packId },
    },
    {
      url: "/api/stamps/favorite",
      method: "POST",
      body: { stamp_id: `${packId}/stamps/okay`, favorite: true },
    },
  ]);
});
