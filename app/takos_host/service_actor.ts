import { Hono } from "hono";
import { getSystemKey } from "../api/services/system_actor.ts";
import { createDB } from "../api/DB/mod.ts";
import {
  createAcceptActivity,
  fetchActorInbox,
  jsonResponse,
  verifyHttpSignature,
  verifyDigest,
  signAndPostAsActor,
} from "../api/utils/activitypub.ts";

/**
 * takos host 用 Service Actor を提供する最小実装
 * - GET /actor
 * - POST /inbox
 * - GET /outbox
 */
export function createServiceActorApp(env: Record<string, string>) {
  const app = new Hono();

  // すべてのリクエストで env を参照できるように付与（root_activitypub.ts と同様の方式）
  app.use("/*", async (c, next) => {
    (c as unknown as { set: (k: string, v: unknown) => void }).set("env", env);
    await next();
  });

  const domain = env["ACTIVITYPUB_DOMAIN"];
  const actorId = `https://${domain}/actor`;

  app.get("/actor", async (c) => {
    const db = createDB(env);
    const { publicKey } = await getSystemKey(db, domain);
    const actor = {
      "@context": [
        "https://www.w3.org/ns/activitystreams",
        "https://w3id.org/security/v1",
      ],
      id: actorId,
      type: "Service",
      preferredUsername: "takos",
      inbox: `https://${domain}/inbox`,
      outbox: `https://${domain}/outbox`,
      publicKey: {
        id: `${actorId}#main-key`,
        owner: actorId,
        publicKeyPem: publicKey,
      },
    };
    return jsonResponse(c, actor, 200, "application/activity+json");
  });

  app.get("/outbox", (c) => {
    // 最小の空 OrderedCollection を返す
    const body = {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: `https://${domain}/outbox`,
      type: "OrderedCollection",
      totalItems: 0,
      orderedItems: [],
    };
    return jsonResponse(c, body, 200, "application/activity+json");
  });

  app.post("/inbox", async (c) => {
    const bodyText = await c.req.text();
    const okDigest = await verifyDigest(c.req.raw, bodyText);
    const okSig = await verifyHttpSignature(c.req.raw, bodyText);
    if (!okDigest || !okSig) {
      return jsonResponse(c, { error: "Invalid signature" }, 401);
    }
    let activity: any;
    try {
      activity = JSON.parse(bodyText);
    } catch {
      return jsonResponse(c, { error: "Bad JSON" }, 400);
    }
    // Follow を受け付け、Accept を返信
    if (activity?.type === "Follow" && activity?.object === actorId) {
      const actor: string = activity.actor;
      try {
        const inbox = await fetchActorInbox(actor, env);
        if (inbox) {
          const accept = createAcceptActivity(domain, actorId, activity);
          // Accept を Service Actor (actorId) の鍵で署名して送信
          const db = createDB(env);
          const { privateKey } = await getSystemKey(db, domain);
          await signAndPostAsActor(
            inbox,
            JSON.stringify(accept),
            actorId,
            privateKey,
          ).catch(() => {});
        }
      } catch (_e) {
        // ignore
      }
      return jsonResponse(c, { status: "accepted" }, 202, "application/activity+json");
    }
    return jsonResponse(c, { status: "ok" }, 202, "application/activity+json");
  });

  return app;
}
