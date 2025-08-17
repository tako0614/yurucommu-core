import { Hono } from "hono";
import { getSystemKey } from "../api/services/system_actor.ts";
import { createDB } from "../api/DB/mod.ts";
import {
  createAcceptActivity,
  createAnnounceActivity,
  fetchActorInbox,
  jsonResponse,
  signAndPostAsActor,
  verifyDigest,
  verifyHttpSignature,
} from "../api/utils/activitypub.ts";

interface ActivityPubActivity {
  type: string;
  actor: string;
  object?: string | ActivityPubActivity;
  [key: string]: unknown;
}

interface QueueItem {
  inbox: string;
  body: string;
  env: Record<string, string>;
}

const followers = new Set<string>();
const queue: QueueItem[] = [];
let delivering = false;

async function deliverQueue() {
  if (delivering) return;
  delivering = true;
  while (queue.length > 0) {
    const { inbox, body, env } = queue.shift()!;
    const domain = env["ACTIVITYPUB_DOMAIN"];
    const actorId = `https://${domain}/actor`;
    try {
      const db = createDB(env);
      const { privateKey } = await getSystemKey(db, domain);
      await signAndPostAsActor(inbox, body, actorId, privateKey);
    } catch {
      // ignore
    }
    const interval = Number(env["SERVICE_DELIVER_MIN_INTERVAL_MS"] || "200");
    if (interval > 0) {
      await new Promise((r) => setTimeout(r, interval));
    }
  }
  delivering = false;
}

function enqueue(env: Record<string, string>, inbox: string, body: string) {
  queue.push({ env, inbox, body });
  deliverQueue();
}

export function announceToFollowers(
  env: Record<string, string>,
  objectUrl: string,
) {
  const domain = env["ACTIVITYPUB_DOMAIN"];
  const actorId = `https://${domain}/actor`;
  const announce = createAnnounceActivity(domain, actorId, objectUrl);
  const body = JSON.stringify(announce);
  for (const inbox of followers) {
    enqueue(env, inbox, body);
  }
}

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
    let activity: ActivityPubActivity;
    try {
      activity = JSON.parse(bodyText) as ActivityPubActivity;
    } catch {
      return jsonResponse(c, { error: "Bad JSON" }, 400);
    }
    // Follow を受け付け、フォロワーの inbox を保存し Accept を返信
    if (activity?.type === "Follow" && activity?.object === actorId) {
      const actor: string = activity.actor;
      try {
        const inbox = await fetchActorInbox(actor, env);
        if (inbox) {
          followers.add(inbox);
          const accept = createAcceptActivity(domain, actorId, activity);
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
      return jsonResponse(
        c,
        { status: "accepted" },
        202,
        "application/activity+json",
      );
    }
    // Undo(Follow) でフォロワーの inbox を削除
    if (
      activity?.type === "Undo" &&
      activity?.object &&
      typeof activity.object === "object" &&
      (activity.object as ActivityPubActivity)?.type === "Follow" &&
      (activity.object as ActivityPubActivity)?.object === actorId
    ) {
      const actor: string = (activity.object as ActivityPubActivity).actor;
      try {
        const inbox = await fetchActorInbox(actor, env);
        if (inbox) followers.delete(inbox);
      } catch {
        /* ignore */
      }
      return jsonResponse(
        c,
        { status: "accepted" },
        202,
        "application/activity+json",
      );
    }
    return jsonResponse(c, { status: "ok" }, 202, "application/activity+json");
  });

  return app;
}
