import type { DB } from "../../shared/db.ts";
import { generateKeyPair } from "../../shared/crypto.ts";

export async function getSystemKey(db: DB, domain: string) {
  let doc = await db.findSystemKey(domain);
  if (!doc) {
    const keys = await generateKeyPair();
    await db.saveSystemKey(domain, keys.privateKey, keys.publicKey);
    doc = { domain, ...keys };
  }
  return doc;
}
