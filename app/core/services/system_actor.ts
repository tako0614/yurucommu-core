import type { DataStore } from "../db/types.ts";
import { generateKeyPair } from "@takos/crypto";

export async function getSystemKey(db: DataStore, domain: string) {
  let doc = await db.system.findKey(domain);
  if (!doc) {
    const keys = await generateKeyPair();
    await db.system.saveKey(domain, keys.privateKey, keys.publicKey);
    doc = { domain, ...keys };
  }
  const account = await db.accounts.findByUserName("system");
  if (!account) {
    await db.accounts.create({
      userName: "system",
      displayName: "system",
      privateKey: doc.privateKey,
      publicKey: doc.publicKey,
    });
  }
  return doc;
}
