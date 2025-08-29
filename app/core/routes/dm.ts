import { type Context, Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import authRequired from "../utils/auth.ts";
import { getEnv } from "@takos/config";
import { getDB } from "../db/mod.ts";
import { sendToUser } from "./ws.ts";
import { getUserInfo } from "../services/user-info.ts";
import {
  createActivityId,
  createObjectId,
  deliverActivityPubObject,
  getDomain as apGetDomain,
  resolveActorFromAcct,
} from "../utils/activitypub.ts";

// DM 用のシンプルな REST エンドポイント

const app = new Hono();
const auth = (c: Context, next: () => Promise<void>) =>
  authRequired(getDB(c))(c, next);
app.use("/dm/*", auth);

app.post(
  "/dm",
  zValidator(
    "json",
    z.object({
      from: z.string(),
      to: z.string(),
      type: z.string(),
      content: z.string().optional(),
      url: z.string().optional(),
      mediaType: z.string().optional(),
      key: z.string().optional(),
      iv: z.string().optional(),
      preview: z.object({
        url: z.string(),
        mediaType: z.string().optional(),
        width: z.number().optional(),
        height: z.number().optional(),
        key: z.string().optional(),
        iv: z.string().optional(),
      }).optional(),
      attachments: z.array(
        z.object({
          url: z.string(),
          mediaType: z.string().optional(),
        }).passthrough(),
      ).optional(),
    }),
  ),
  async (c) => {
    const {
      from,
      to,
      type,
      content,
      url,
      mediaType,
      key,
      iv,
      preview,
      attachments,
    } = c.req.valid("json") as {
      from: string;
      to: string;
      type: string;
      content?: string;
      url?: string;
      mediaType?: string;
      key?: string;
      iv?: string;
      preview?: Record<string, unknown>;
      attachments?: Record<string, unknown>[];
    };
    if (
      type === "note"
        ? !(typeof content === "string" && content.trim())
        : !(typeof url === "string" && url && typeof mediaType === "string" &&
          mediaType)
    ) {
      return c.json({ error: "Invalid body" }, 400);
    }
    const env = getEnv(c);
    const db = getDB(c);
    const domain = env["ACTIVITYPUB_DOMAIN"] ?? "";
    const [fromUserName, fromDomain] = from.split("@");
    const fromHandle = from;
    const localName = fromDomain === domain ? fromUserName : "";
    const [_fromInfo, _toInfo] = await Promise.all([
      getUserInfo(db, fromHandle, domain).catch(() => null),
      getUserInfo(db, to, domain).catch(() => null),
    ]);
    // Normalize attachments: if attachments array not provided but a url/mediaType
    // is present, convert it into a single-element attachments array so that
    // downstream storage and client consumers can rely on attachments being
    // present in the returned payload.
    const attachmentsNormalized: Record<string, unknown>[] | undefined =
      Array.isArray(attachments)
        ? attachments
        : (url && mediaType)
        ? [
          {
            url,
            mediaType,
            ...(typeof key === "string" ? { key } : {}),
            ...(typeof iv === "string" ? { iv } : {}),
            ...(preview && typeof preview === "object" ? { preview } : {}),
          },
        ]
        : undefined;

    const payload = await db.dms.save(
      localName,
      to,
      type,
      content,
      attachmentsNormalized,
      url,
      mediaType,
      key,
      iv,
      preview,
    );
    (payload as { from: string }).from = fromHandle;
    await Promise.all([
      db.dms.create({ owner: fromHandle, id: to }),
      db.dms.create({ owner: to, id: fromHandle }),
    ]);
    sendToUser(to, { type: "dm", payload });
    sendToUser(fromHandle, { type: "dm", payload });

    // 外部宛てなら ActivityPub で配送する
    try {
      const localDomain = apGetDomain(c);
      const toHost = to.split("@")[1] ?? "";

      // 送信者はローカルユーザーのみを許可（鍵を使って署名するため）
      if (toHost && toHost !== localDomain && localName) {
        // ActivityPub Create(Object) を構築
        const actorId = `https://${localDomain}/users/${
          encodeURIComponent(localName)
        }`;
        const objectId = createObjectId(localDomain);
        const activityId = createActivityId(localDomain);

        // 添付は ActivityStreams の attachment として送る
        // Preserve encryption metadata (key/iv) and preview when sending attachments
        // to remote ActivityPub actors so they can fetch and decrypt previews/files.
        const asAttachments = Array.isArray(attachments)
          ? attachments
            .map((a) => {
              const rec = a as Record<string, unknown>;
              const u = typeof rec.url === "string" ? rec.url : "";
              const mType = typeof rec.mediaType === "string"
                ? rec.mediaType
                : undefined;
              const key = typeof rec.key === "string" ? rec.key : undefined;
              const iv = typeof rec.iv === "string" ? rec.iv : undefined;
              const preview = rec.preview && typeof rec.preview === "object"
                ? rec.preview as Record<string, unknown>
                : undefined;
              if (!u) return null;
              const t = mType?.startsWith("image/")
                ? "Image"
                : mType?.startsWith("video/")
                ? "Video"
                : mType?.startsWith("audio/")
                ? "Audio"
                : "Document";
              const out: Record<string, unknown> = { type: t, url: u };
              if (mType) out.mediaType = mType;
              if (key) out.key = key;
              if (iv) out.iv = iv;
              if (preview) out.preview = preview;
              return out;
            })
            .filter(Boolean) as Record<string, unknown>[]
          : undefined;

        const objectType = type === "image"
          ? "Image"
          : type === "video"
          ? "Video"
          : type === "file"
          ? "Document"
          : "Note";
        const obj: Record<string, unknown> = {
          "@context": "https://www.w3.org/ns/activitystreams",
          id: objectId,
          type: objectType,
          attributedTo: actorId,
          to: [to],
          extra: { dm: true },
        };
        if (objectType === "Note") {
          obj.content = content ?? "";
          if (asAttachments && asAttachments.length > 0) {
            obj.attachment = asAttachments;
          }
        } else if (url) {
          obj.url = url;
          if (mediaType) obj.mediaType = mediaType;
          if (content) obj.name = content;
        } else if (asAttachments && asAttachments.length > 0) {
          const att = asAttachments[0];
          obj.url = att.url;
          if (att.mediaType) obj.mediaType = att.mediaType;
          if (content) obj.name = content;
        }

        const resolved = await resolveActorFromAcct(to).catch(() => null);
        if (!resolved?.id) {
          console.error("acct 解決に失敗", to);
        } else {
          const toActor = resolved.id;
          obj.to = [toActor];
          const activity = {
            "@context": "https://www.w3.org/ns/activitystreams",
            id: activityId,
            type: "Create" as const,
            actor: actorId,
            to: [toActor],
            object: obj,
          };
          await deliverActivityPubObject(
            [toActor],
            activity,
            fromUserName,
            localDomain,
            db,
          ).catch((err) => {
            console.error("DM delivery failed:", err);
          });
        }
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
    const db = getDB(c);
    const messages = await db.dms.listBetween(user1, user2);
    return c.json(messages);
  },
);

export default app;
