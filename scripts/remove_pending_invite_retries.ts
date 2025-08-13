import { loadConfig } from "../app/shared/config.ts";
import { connectDatabase } from "../app/shared/db.ts";
import PendingInvite from "../app/api/models/takos/pending_invite.ts";

async function main() {
  const env = await loadConfig();
  await connectDatabase(env);
  await PendingInvite.updateMany({}, { $unset: { retries: "" } });
  console.log("retries フィールドを削除しました");
}

if (import.meta.main) {
  main().catch((e) => console.error(e));
}
