import type { DB } from "../../shared/db.ts";
import { generateKeyPair } from "../../shared/crypto.ts";

export async function getSystemKey(db: DB, domain: string) {
  const collection = (await db.getDatabase()).collection("system_key");
  let doc = await collection.findOne<{
    domain: string;
    privateKey: string;
    publicKey: string;
  }>({ domain });
  if (!doc) {
    const keys = await generateKeyPair();
    doc = { domain, ...keys };
    await collection.insertOne(doc);
  }
  return doc;
}
