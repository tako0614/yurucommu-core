import {
  createCommitAndWelcomesWithTsMLS,
  generateKeyPackageWithTsMLS,
} from "./ts_mls_core.ts";
import { decodeMlsMessage } from "npm:ts-mls";
import "npm:@noble/curves/p256";

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

Deno.test("ts-mlsでKeyPackageとWelcomeを生成できる", async () => {
  const alice = await generateKeyPackageWithTsMLS("alice");
  const bob = await generateKeyPackageWithTsMLS("bob");
  const { welcomes } = await createCommitAndWelcomesWithTsMLS(
    "group1",
    alice,
    [bob.encoded],
  );
  if (welcomes.length !== 1) throw new Error("welcome生成に失敗");
  const decoded = decodeMlsMessage(b64ToBytes(welcomes[0]), 0)?.[0];
  if (!decoded || decoded.wireformat !== "mls_welcome") {
    throw new Error("welcomeが不正");
  }
});
