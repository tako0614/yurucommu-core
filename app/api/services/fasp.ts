// FASP 送信側の最小アナウンス機能
import { createDB } from "../DB/mod.ts";

export interface FaspAnnouncement {
  source?: Record<string, unknown>;
  category: "content" | "account";
  eventType: "new" | "update" | "delete" | "trending";
  objectUris: string[];
  moreObjectsAvailable?: boolean;
}

async function computeContentDigest(body: string): Promise<string> {
  const buf = new TextEncoder().encode(body);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  const b64 = btoa(String.fromCharCode(...new Uint8Array(hash)));
  return `sha-256=:${b64}:`;
}

export async function sendAnnouncements(
  env: Record<string, string>,
  ann: FaspAnnouncement,
): Promise<void> {
  const db = createDB(env);
  const mongo = await db.getDatabase();
  const fasps = await mongo.collection("fasps").find({}).toArray();
  if (!fasps || fasps.length === 0) return;
  const body = JSON.stringify({
    source: ann.source ?? { subscription: { id: "default" } },
    category: ann.category,
    eventType: ann.eventType,
    objectUris: ann.objectUris,
    moreObjectsAvailable: !!ann.moreObjectsAvailable,
  });
  const contentDigest = await computeContentDigest(body);
  await Promise.all(
    fasps.map(async (p: { baseUrl?: string }) => {
      const baseUrl = (p.baseUrl ?? "").replace(/\/$/, "");
      if (!baseUrl) return;
      const url = `${baseUrl}/data_sharing/v0/announcements`;
      try {
        await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            Accept: "application/json",
            "Content-Digest": contentDigest,
          },
          body,
        });
      } catch {
        // ignore errors for now
      }
    }),
  );
}

export async function getFaspBaseUrl(
  env: Record<string, string>,
  capability: string,
): Promise<string | null> {
  const db = createDB(env);
  const mongo = await db.getDatabase();
  const rec = await mongo.collection("fasps").findOne({
    status: "approved",
    [`capabilities.${capability}.enabled`]: true,
  });
  if (!rec?.baseUrl) return null;
  return String(rec.baseUrl).replace(/\/$/, "");
}
