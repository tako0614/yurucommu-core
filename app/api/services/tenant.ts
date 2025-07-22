import type { DB } from "../../shared/db.ts";

export async function ensureTenant(
  db: DB,
  id: string,
  domain: string,
) {
  const collection = (await db.getDatabase()).collection("tenant");
  const exists = await collection.findOne({ _id: id });
  if (!exists) {
    await collection.insertOne({ _id: id, domain, created_at: new Date() });
  }
}
