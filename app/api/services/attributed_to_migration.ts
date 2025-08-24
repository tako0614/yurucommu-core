import { createDB } from "../DB/mod.ts";

// 既存の Note ドキュメントの attributedTo を完全な URL へ更新する
export async function migrateAttributedTo(env: Record<string, string>) {
  const domain = env["ACTIVITYPUB_DOMAIN"] ?? "";
  if (!domain) return;
  const db = createDB(env);
  const mongo = await db.getDatabase();
  const notes = mongo.collection<Record<string, unknown>>("notes");
  const all = await notes.find({}).toArray();
  for (const d of all) {
    const attr = typeof d.attributedTo === "string" ? d.attributedTo : "";
    if (attr && !attr.startsWith("http")) {
      const url = `https://${domain}/users/${attr}`;
      await notes.updateOne({ _id: d._id }, {
        $set: { attributedTo: url, actor_id: url },
      });
    }
  }
}
