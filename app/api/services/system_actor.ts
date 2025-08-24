import type { DB } from "../../shared/db.ts";
import { generateKeyPair } from "../../shared/crypto.ts";

export async function getSystemKey(db: DB, domain: string) {
  let doc = await db.findSystemKey(domain);
  if (!doc) {
    const keys = await generateKeyPair();
    await db.saveSystemKey(domain, keys.privateKey, keys.publicKey);
    doc = { domain, ...keys };
  }
  const account = await db.findAccountByUserName("system");
  if (!account) {
    await db.createAccount({
      userName: "system",
      displayName: "system",
      privateKey: doc.privateKey,
      publicKey: doc.publicKey,
    });
  }
  return doc;
}
