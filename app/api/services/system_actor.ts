import SystemKey from "../models/takos/system_key.ts";
import { generateKeyPair } from "../../shared/crypto.ts";

export async function getSystemKey(domain: string) {
  let doc = await SystemKey.findOne({ domain }).lean<{
    domain: string;
    privateKey: string;
    publicKey: string;
  }>();
  if (!doc) {
    const keys = await generateKeyPair();
    doc = { domain, ...keys };
    await SystemKey.create(doc);
  }
  return doc;
}
