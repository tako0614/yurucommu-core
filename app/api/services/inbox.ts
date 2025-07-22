import type { DB } from "../../shared/db.ts";

export async function addInboxEntry(
  db: DB,
  tenantId: string,
  objectId: string,
) {
  const collection = (await db.getDatabase()).collection("inbox_entry");
  await collection.updateOne(
    { tenant_id: tenantId, object_id: objectId },
    { $setOnInsert: { received_at: new Date() } },
    { upsert: true },
  );
}
