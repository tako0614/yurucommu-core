import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import { stub } from "https://deno.land/std@0.208.0/testing/mock.ts";
import { registerKeyPackage } from "./e2ee.ts";
import { createDB } from "../DB/mod.ts";

Deno.test("/keyPackages/bulk で KeyPackage の identity を検証できる", async () => {
  const domain = "example.com";
  const env: Record<string, string> = {};
  let counter = 0;
  const db = {
    createKeyPackage(
      _user: string,
      content: string,
      mediaType: string,
      encoding: string,
      _groupInfo?: string,
      _expiresAt?: Date,
      _deviceId?: string,
      _version?: string,
      _cipherSuite?: number,
      _generator?: unknown,
    ) {
      counter++;
      return Promise.resolve({
        _id: counter,
        content,
        mediaType,
        encoding,
        createdAt: new Date().toISOString(),
        version: "1.0",
        cipherSuite: 1,
        generator: "g",
      });
    },
    cleanupKeyPackages(_user: string) {
      return Promise.resolve();
    },
  };
  const fetchStub = stub(
    globalThis,
    "fetch",
    () => Promise.resolve(new Response("{}", { status: 200 })),
  );
  const deliver = () => Promise.resolve();
  try {
    const good = btoa("good");
    const bad = btoa("bad");
    const body = [{
      user: "alice",
      keyPackages: [
        { content: good, mediaType: "message/mls", encoding: "base64" },
        { content: bad, mediaType: "message/mls", encoding: "base64" },
      ],
    }];
    const results: unknown[] = [];
    for (const item of body) {
      const resList: unknown[] = [];
      for (const kp of item.keyPackages) {
        const r = await registerKeyPackage(
          env,
          domain,
          db as unknown as ReturnType<typeof createDB>,
          item.user,
          kp,
          undefined,
          deliver,
        );
        resList.push(r);
      }
      results.push({ user: item.user, results: resList });
    }
    const first = (results[0] as { results: unknown[] }).results;
    assert("keyId" in (first[0] as Record<string, unknown>));
    assertEquals(first[1], { error: "ap_mls.binding.identity_mismatch" });
  } finally {
    fetchStub.restore();
  }
});
