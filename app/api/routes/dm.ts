import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import authRequired from "../utils/auth.ts";
import { getEnv } from "../../shared/config.ts";
import { createDB } from "../DB/mod.ts";
import { sendToUser } from "./ws.ts";
import { getUserInfo } from "../services/user-info.ts";
import {
  createActivityId,
  createObjectId,
  deliverActivityPubObject,
  getDomain as apGetDomain,
} from "../utils/activitypub.ts";

// DM 用のシンプルな REST エンドポイント

const app = new Hono();
app.use("/dm/*", authRequired);

app.post(
  "/dm",
  zValidator(
    "json",
    z.object({
      from: z.string(),
      to: z.string(),
      type: z.string(),
      content: z.string().optional(),
      attachments: z.array(
        z.object({
          url: z.string(),
          mediaType: z.string().optional(),
        }).passthrough(),
      ).optional(),
    }),
  ),
  async (c) => {
    const { from, to, type, content, attachments } = c.req.valid("json") as {
      from: string;
      to: string;
      type: string;
      content?: string;
      attachments?: Record<string, unknown>[];
    };
    const env = getEnv(c);
    const db = createDB(env);
    const domain = env["ACTIVITYPUB_DOMAIN"] ?? "";
    const fromUserName = (() => {
      if (from.includes("@")) {
        const [name, host] = from.split("@");
        return host === domain ? name : "";
      }
      return from;
    })();
    const fromHandle = `${fromUserName}@${domain}`;
    const [fromInfo, toInfo] = await Promise.all([
      getUserInfo(fromUserName, domain, env).catch(() => null),
      getUserInfo(to, domain, env).catch(() => null),
    ]);
    const payload = await db.saveDMMessage(
      fromUserName,
      to,
      type,
      content,
      attachments,
    );
    (payload as { from: string }).from = fromHandle;
    await Promise.all([
      db.createDirectMessage({
        owner: fromHandle,
        id: to,
        name: toInfo?.displayName || toInfo?.userName || to,
        icon: toInfo?.authorAvatar,
        members: [fromHandle, to],
      }),
      db.createDirectMessage({
        owner: to,
        id: fromHandle,
        name: fromInfo?.displayName || fromInfo?.userName || fromHandle,
        icon: fromInfo?.authorAvatar,
        members: [fromHandle, to],
      }),
    ]);
    sendToUser(to, { type: "dm", payload });
    sendToUser(fromHandle, { type: "dm", payload });

    // 外部宛てなら ActivityPub で配送する
    try {
      const localDomain = apGetDomain(c);
      // 宛先のホスト名を推定（URL か user@host）
      const toHost = (() => {
        try {
          if (to.startsWith("http")) return new URL(to).hostname;
          if (to.includes("@")) return to.split("@")[1];
        } catch {
          /* noop */
        }
        return "";
      })();

      // 送信者はローカルユーザーのみを許可（鍵を使って署名するため）
      if (toHost && toHost !== localDomain && fromUserName) {
        // ActivityPub Create(Object) を構築
        const actorId = `https://${localDomain}/users/${
          encodeURIComponent(fromUserName)
        }`;
        const objectId = createObjectId(localDomain);
        const activityId = createActivityId(localDomain);

        // 添付は ActivityStreams の attachment として送る
        const asAttachments = Array.isArray(attachments)
          ? attachments
            .map((a) => {
              const url = typeof (a as { url?: unknown }).url === "string"
                ? (a as { url: string }).url
                : "";
              const mediaType =
                typeof (a as { mediaType?: unknown }).mediaType === "string"
                  ? (a as { mediaType: string }).mediaType
                  : undefined;
              if (!url) return null;
              const t = mediaType?.startsWith("image/")
                ? "Image"
                : mediaType?.startsWith("video/")
                ? "Video"
                : mediaType?.startsWith("audio/")
                ? "Audio"
                : "Document";
              return { type: t, url, mediaType } as Record<string, unknown>;
            })
            .filter(Boolean) as Record<string, unknown>[]
          : undefined;

        const obj: Record<string, unknown> = {
          "@context": "https://www.w3.org/ns/activitystreams",
          id: objectId,
          type: type && type !== "note"
            ? type.charAt(0).toUpperCase() + type.slice(1)
            : "Note",
          attributedTo: actorId,
          content: content ?? "",
          to: [to],
          extra: { dm: true },
        };
        if (asAttachments && asAttachments.length > 0) {
          obj.attachment = asAttachments;
        }

        const activity = {
          "@context": "https://www.w3.org/ns/activitystreams",
          id: activityId,
          type: "Create" as const,
          actor: actorId,
          to: [to],
          object: obj,
        };

        // deliverActivityPubObject は acct 形式（user@host）も解決可能
        await deliverActivityPubObject(
          [to],
          activity,
          fromUserName,
          localDomain,
          env,
        )
          .catch((err) => {
            console.error("DM delivery failed:", err);
          });
      }
    } catch (err) {
      console.error("/api/dm ActivityPub delivery error:", err);
    }
    // payload can be an arbitrary object/structure from DB; cast to a generic record to satisfy Hono's c.json typing
    return c.json(payload as Record<string, unknown>);
  },
);

app.get(
  "/dm",
  zValidator(
    "query",
    z.object({ user1: z.string(), user2: z.string() }),
  ),
  async (c) => {
    const { user1, user2 } = c.req.valid("query") as {
      user1: string;
      user2: string;
    };
    const db = createDB(getEnv(c));
    const messages = await db.listDMsBetween(user1, user2);
    return c.json(messages);
  },
);

export default app;
