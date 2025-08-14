function assert(condition: boolean, message?: string): void {
  if (!condition) throw new Error(message ?? "assertion failed");
}
function assertEquals<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) {
    throw new Error(message ?? `assertion failed: ${actual} !== ${expected}`);
  }
}
import {
  createCommitAndWelcomes,
  generateKeyPackage,
  verifyKeyPackage,
} from "./mls_core.ts";

Deno.test("KeyPackageの生成とWelcome生成", async () => {
  const bob = await generateKeyPackage("bob");
  assert(await verifyKeyPackage(bob.encoded));
  const { commit, welcomes } = await createCommitAndWelcomes(1, ["alice"], [
    { content: bob.encoded, actor: "bob" },
  ]);
  assert(commit instanceof Uint8Array);
  assertEquals(welcomes.length, 1);
});
