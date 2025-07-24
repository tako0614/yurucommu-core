import type { DB } from "../../shared/db.ts";

export async function addInboxEntry(
  db: DB,
  tenantId: string,
  objectId: string,
) {
  await db.addInboxEntry(tenantId, objectId);
}
