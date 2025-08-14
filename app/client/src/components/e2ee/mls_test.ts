function assert(condition: boolean, message?: string): void {
  if (!condition) throw new Error(message ?? "assertion failed");
}
function assertEquals<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) {
    throw new Error(message ?? `assertion failed: ${actual} !== ${expected}`);
  }
}
import {
  createMLSGroup,
  decryptGroupMessage,
  encryptGroupMessage,
  generateKeyPackage,
  verifyWelcome,
} from "./mls.ts";
import { createCommitAndWelcomes } from "../../../../shared/mls_core.ts";
import { b64ToBuf, bufToB64 } from "../../../../shared/buffer.ts";

Deno.test("Welcome検証後にメッセージの暗号化と復号が可能", async () => {
  const { keyPackage, keyPair } = await generateKeyPackage();
  const { welcomes } = await createCommitAndWelcomes(1, ["alice"], [
    { content: keyPackage.data, actor: "bob" },
  ]);
  const welcomeBody = JSON.parse(new TextDecoder().decode(welcomes[0].data));
  const result = await verifyWelcome(
    "bob",
    keyPair,
    welcomeBody,
    welcomeBody.group,
    1,
  );
  assert(result.valid);
  const bobGroup = result.group!;
  const aliceGroup = await createMLSGroup(
    "alice",
    bobGroup.members,
    bobGroup.epoch,
    bobGroup.rootSecret,
    bobGroup.suite,
    bobGroup.groupKey,
  );
  const cipher = await encryptGroupMessage(bobGroup, "hello");
  const plain = await decryptGroupMessage(aliceGroup, cipher);
  assertEquals(plain, "hello");
});

Deno.test("改ざんされたWelcomeは検証に失敗する", async () => {
  const { keyPackage, keyPair } = await generateKeyPackage();
  const { welcomes } = await createCommitAndWelcomes(1, ["alice"], [
    { content: keyPackage.data, actor: "bob" },
  ]);
  const welcomeBody = JSON.parse(new TextDecoder().decode(welcomes[0].data));
  const bad = { ...welcomeBody, group: "AAAA" };
  const result = await verifyWelcome(
    "bob",
    keyPair,
    bad,
    welcomeBody.group,
    1,
  );
  assert(!result.valid);
});

Deno.test("改ざんされた暗号文は復号に失敗する", async () => {
  const { keyPackage, keyPair } = await generateKeyPackage();
  const { welcomes } = await createCommitAndWelcomes(1, ["alice"], [
    { content: keyPackage.data, actor: "bob" },
  ]);
  const welcomeBody = JSON.parse(new TextDecoder().decode(welcomes[0].data));
  const { group: bobGroup } = await verifyWelcome(
    "bob",
    keyPair,
    welcomeBody,
    welcomeBody.group,
    1,
  );
  const aliceGroup = await createMLSGroup(
    "alice",
    bobGroup!.members,
    bobGroup!.epoch,
    bobGroup!.rootSecret,
    bobGroup!.suite,
    bobGroup!.groupKey,
  );
  const cipher = await encryptGroupMessage(bobGroup!, "hi");
  const bytes = b64ToBuf(cipher);
  bytes[bytes.length - 1] ^= 0xff;
  const tampered = bufToB64(bytes);
  const plain = await decryptGroupMessage(aliceGroup, tampered);
  assertEquals(plain, null);
});
