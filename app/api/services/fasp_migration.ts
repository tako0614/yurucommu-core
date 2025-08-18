// 旧コレクションから新コレクションへ移行するユーティリティ（安全な片道コピー）
import { createDB } from "../DB/mod.ts";

type AnyDoc = Record<string, unknown>;

export async function migrateFaspCollections(env: Record<string, string>) {
  const tenantId = env["ACTIVITYPUB_DOMAIN"] ?? "";
  if (!tenantId) return; // テナント識別子がない場合は何もしない
  const db = createDB(env);
  const mongo = await db.getDatabase();

  const legacyProviders = mongo.collection<AnyDoc>("fasps");
  const newProviders = mongo.collection<AnyDoc>("fasp_client_providers");
  const legacySettings = mongo.collection<AnyDoc>("fasp_settings");
  const newSettings = mongo.collection<AnyDoc>("fasp_client_settings");
  const legacySubs = mongo.collection<AnyDoc>("fasp_event_subscriptions");
  const newSubs = mongo.collection<AnyDoc>("fasp_client_event_subscriptions");
  const legacyBackfills = mongo.collection<AnyDoc>("fasp_backfills");
  const newBackfills = mongo.collection<AnyDoc>("fasp_client_backfills");

  // providers: baseUrl/serverId で upsert
  try {
    const countNew = await newProviders.countDocuments({ tenant_id: tenantId });
    if (countNew === 0) {
      const cur = legacyProviders.find({ tenant_id: tenantId });
      const all = await cur.toArray();
      for (const d of all) {
        const baseUrl = String(d.baseUrl ?? "");
        const serverId = String(d.serverId ?? "");
        if (!baseUrl && !serverId) continue;
        const doc: AnyDoc = {
          tenant_id: tenantId,
          name: (d.name ?? (baseUrl || serverId)),
          baseUrl,
          serverId,
          faspId: d.faspId ?? crypto.randomUUID(),
          publicKey: d.publicKey ?? "",
          status: d.status ?? "pending",
          capabilities: d.capabilities ?? {},
          secret: d.secret ?? "",
          createdAt: d.createdAt ?? new Date(),
          updatedAt: new Date(),
          approvedAt: d.approvedAt ?? null,
          rejectedAt: d.rejectedAt ?? null,
        };
        await newProviders.updateOne(
          { tenant_id: tenantId, $or: [{ baseUrl }, { serverId }] },
          {
            $set: doc,
            $setOnInsert: { faspId: doc.faspId, createdAt: doc.createdAt },
          },
          { upsert: true },
        );
      }
    }
  } catch (_) {
    // ignore migration errors to not block startup
  }

  // settings: 単一ドキュメントをコピー
  try {
    const existsNew = await newSettings.findOne({
      _id: "default",
      tenant_id: tenantId,
    });
    if (!existsNew) {
      const legacy = await legacySettings.findOne({
        _id: "default",
        tenant_id: tenantId,
      });
      if (legacy) {
        await newSettings.updateOne(
          { _id: "default", tenant_id: tenantId },
          {
            $set: {
              searchServerId: legacy.searchServerId ?? null,
              shareEnabled: legacy.shareEnabled ?? true,
              shareServerIds: legacy.shareServerIds ?? null,
              updatedAt: new Date(),
            },
            $setOnInsert: {
              _id: "default",
              tenant_id: tenantId,
              createdAt: new Date(),
            },
          },
          { upsert: true },
        );
      }
    }
  } catch (_) {
    // ignore
  }

  // event subscriptions
  try {
    const countNew = await newSubs.countDocuments({ tenant_id: tenantId });
    if (countNew === 0) {
      const all = await legacySubs.find({ tenant_id: tenantId }).toArray();
      if (all.length > 0) await newSubs.insertMany(all.map((d) => ({ ...d })));
    }
  } catch (_) {
    // ignore
  }

  // backfills
  try {
    const countNew = await newBackfills.countDocuments({ tenant_id: tenantId });
    if (countNew === 0) {
      const all = await legacyBackfills.find({ tenant_id: tenantId }).toArray();
      if (all.length > 0) {
        await newBackfills.insertMany(all.map((d) => ({ ...d })));
      }
    }
  } catch (_) {
    // ignore
  }
}
