import InboxEntry from "../models/takos/inbox_entry.ts";

export async function addInboxEntry(tenantId: string, objectId: string) {
  await InboxEntry.updateOne(
    { tenant_id: tenantId, object_id: objectId },
    { $setOnInsert: { received_at: new Date() } },
    { upsert: true },
  );
}
