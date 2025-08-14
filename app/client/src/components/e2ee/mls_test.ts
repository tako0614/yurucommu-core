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
} from "../../../../shared/mls_core.ts";

Deno.test("ts-mlsでCommitとWelcomeを生成できる", async () => {
  const bob = await generateKeyPackage("bob");
  const { commit, welcomes } = await createCommitAndWelcomes(1, ["alice"], [
    { content: bob.encoded, actor: "bob" },
  ]);
  assert(commit instanceof Uint8Array);
  assertEquals(welcomes.length, 1);
});
