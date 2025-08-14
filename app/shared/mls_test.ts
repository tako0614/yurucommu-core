function assert(condition: boolean, message?: string): void {
  if (!condition) throw new Error(message ?? "assertion failed");
}
function assertEquals<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) {
    throw new Error(message ?? `assertion failed: ${actual} !== ${expected}`);
  }
}
import { createCommitAndWelcomes, verifyKeyPackage } from "./mls_core.ts";
import { decodeKeyPackage, encodeKeyPackage } from "./mls_message.ts";
import { generateKeyPackage } from "../client/src/components/e2ee/mls.ts";

Deno.test("KeyPackageの署名検証とWelcome生成", async () => {
  const { keyPackage } = await generateKeyPackage();
  const decoded = decodeKeyPackage(keyPackage.data)!;
  const obj = JSON.parse(new TextDecoder().decode(decoded));
  assert(await verifyKeyPackage(obj));

  const { commit, welcomes } = await createCommitAndWelcomes(1, ["alice"], [
    { content: keyPackage.data, actor: "bob" },
  ]);
  assert(commit instanceof Uint8Array);
  assertEquals(welcomes.length, 1);
  const welcomeBody = JSON.parse(new TextDecoder().decode(welcomes[0].data));
  assertEquals(welcomeBody.type, "welcome");
});

Deno.test("署名が不正なKeyPackageは拒否される", async () => {
  const { keyPackage } = await generateKeyPackage();
  const decoded = decodeKeyPackage(keyPackage.data)!;
  const obj = JSON.parse(new TextDecoder().decode(decoded));
  obj.signature = obj.signature.replace(/./g, "A");
  const tampered = encodeKeyPackage(JSON.stringify(obj));

  const { welcomes } = await createCommitAndWelcomes(1, ["alice"], [
    { content: tampered, actor: "bob" },
  ]);
  assertEquals(welcomes.length, 0);
});
