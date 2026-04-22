import { assertEquals, assertRejects } from "jsr:@std/assert";
import { decrypt, DecryptionError, encrypt } from "../../lib/crypto.ts";

const KEY = "00".repeat(32);
const OTHER_KEY = "11".repeat(32);

Deno.test("crypto decrypt - rejects malformed encrypted payloads without plaintext fallback", async () => {
  for (
    const payload of [
      "legacy-plaintext-token",
      "abcd:",
      ":abcd",
      "abcd:efgh",
      "00:11",
      `${"00".repeat(12)}:${"11".repeat(16)}:extra`,
    ]
  ) {
    await assertRejects(
      () => decrypt(payload, KEY),
      DecryptionError,
    );
  }
});

Deno.test("crypto decrypt - round trips valid encrypted values", async () => {
  const encrypted = await encrypt("sensitive-token", KEY);
  assertEquals(await decrypt(encrypted, KEY), "sensitive-token");
});

Deno.test("crypto decrypt - rejects valid payloads with the wrong key", async () => {
  const encrypted = await encrypt("sensitive-token", KEY);
  await assertRejects(
    () => decrypt(encrypted, OTHER_KEY),
    DecryptionError,
  );
});
