import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
type ActivityObject = Record<string, unknown>;
import { createDB } from "../DB/mod.ts";

// 型定義用のimport
import { getEnv } from "../../shared/config.ts";

type ActivityPubObjectType = ActivityObject;
import {
  buildActivityFromStored,
  createAnnounceActivity,
  createCreateActivity,
  createLikeActivity,
  deliverActivityPubObject,
  fetchActorInbox,
  getDomain,
  isLocalActor,
} from "../utils/activitypub.ts";
import { deliverToFollowers } from "../utils/deliver.ts";
import authRequired from "../utils/auth.ts";
import {
  formatUserInfoForPost,
  getUserInfo,
  getUserInfoBatch,
} from "../services/user-info.ts";
import { addNotification } from "../services/notification.ts";
import { rateLimit } from "../utils/rate_limit.ts";
import { broadcast, sendToUser } from "./ws.ts";
import { announceIfPublicAndDiscoverable } from "../services/fasp.ts";

interface PostDoc {
  _id?: string;
  attributedTo?: string;
  actor_id?: string;
  content?: string;
  published?: string | Date;
  extra?: Record<string, unknown>;
}

const app = new Hono();
app.use("/posts/*", authRequired);

app.get("/posts", async (c) => {
  const domain = getDomain(c);
  const env = getEnv(c);
  const tenantId = env["ACTIVITYPUB_DOMAIN"] ?? "";
  const actor = c.req.query("actor");
  const timeline = c.req.query("timeline") ?? "latest";
  const limit = Math.min(
    parseInt(c.req.query("limit") ?? "50", 10) || 50,
    100,
  );
  const before = c.req.query("before");
  const db = createDB(env);
  let list: ActivityPubObjectType[];
  if (timeline === "following" && actor && tenantId) {
    list = await db.listTimeline(actor, {
      limit,
      before: before ? new Date(before) : undefined,
    }) as ActivityObject[];
  } else {
    list = await db.getPublicNotes(
      limit,
      before ? new Date(before) : undefined,
    ) as ActivityObject[];
  }

  const identifiers = list.map((doc) => doc.actor_id as string);
  const userInfos = await getUserInfoBatch(
    identifiers as string[],
    domain,
    env,
  );
  const formatted = list.map((doc, index) => {
    const userInfo = userInfos[index];
    const postData = {
      _id: doc._id,
      content: doc.content,
      published: doc.published,
      extra: doc.extra,
    } as Record<string, unknown>;
    return formatUserInfoForPost(userInfo, postData);
  });

  return c.json(formatted);
});

app.post(
  "/posts",
  rateLimit({ windowMs: 60_000, limit: 10 }),
  zValidator(
    "json",
    z.object({
      author: z.string(),
      content: z.string(),
      attachments: z.array(z.unknown()).optional(),
      parentId: z.string().optional(),
      quoteId: z.string().optional(),
    }),
  ),
  async (c) => {
    const domain = getDomain(c);
    const {
      author,
      content,
      attachments,
      parentId,
      quoteId,
    } = c.req.valid("json") as {
      author: string;
      content: string;
      attachments?: unknown[];
      parentId?: string;
      quoteId?: string;
    };

    const extra: Record<string, unknown> = { likes: 0, retweets: 0 };
    if (Array.isArray(attachments)) extra.attachments = attachments;
    if (typeof parentId === "string") extra.inReplyTo = parentId;
    if (typeof quoteId === "string") extra.quoteId = quoteId;
    if (typeof parentId === "string") extra.replies = 0;

    const env = getEnv(c);
    const db = createDB(env);
    const post = await db.saveNote(
      domain,
      author,
      content,
      extra,
    ) as ActivityObject;

    if (typeof parentId === "string") {
      await db.updateNote(parentId, { $inc: { "extra.replies": 1 } }).catch(
        () => {},
      );
    }

    const baseObj = post as Record<string, unknown>;
    const noteObject = buildActivityFromStored(
      {
        ...baseObj,
        content: typeof post.content === "string" ? post.content : "",
        _id: String(baseObj._id),
        type: typeof baseObj.type === "string" ? baseObj.type : "Note",
        published: typeof baseObj.published === "string"
          ? baseObj.published
          : new Date().toISOString(),
        extra: (typeof baseObj.extra === "object" && baseObj.extra !== null &&
            !Array.isArray(baseObj.extra))
          ? baseObj.extra as Record<string, unknown>
          : {},
      },
      domain,
      author,
      false,
    );
    const createActivity = createCreateActivity(
      domain,
      `https://${domain}/users/${author}`,
      noteObject,
    );
    deliverToFollowers(env, author, createActivity, domain);

    // FASP へ URI のみのアナウンスを送信（公開投稿のみ）
    const objectId = String((post as Record<string, unknown>)._id ?? "");
    if (objectId) {
      const objectUrl = `https://${domain}/objects/${objectId}`;
      await announceIfPublicAndDiscoverable(env, {
        category: "content",
        eventType: "new",
        objectUris: [objectUrl],
      }, post);
    }

    if (typeof parentId === "string") {
      const parent = await db.getObject(parentId) as ActivityObject | null;
      if (
        parent &&
        typeof (parent as PostDoc).actor_id === "string" &&
        !isLocalActor((parent as PostDoc).actor_id as string, domain)
      ) {
        const inbox = await fetchActorInbox(
          (parent as PostDoc).actor_id as string,
          env,
        );
        if (inbox) {
          deliverActivityPubObject(
            [inbox],
            createActivity,
            author,
            domain,
            env,
          );
        }
      } else if (
        parent &&
        typeof (parent as PostDoc).actor_id === "string"
      ) {
        const url = new URL((parent as PostDoc).actor_id as string);
        const localName = url.pathname.split("/")[2];
        if (
          localName && localName !== author && isLocalActor(url.href, domain)
        ) {
          await addNotification(
            "新しい返信",
            `${author}さんが${localName}さんの投稿に返信しました`,
            "info",
            env,
          );
        }
      }
    }

    const postData = post as PostDoc;
    const userInfo = await getUserInfo(
      postData.actor_id as string,
      domain,
      env,
    );
    const formatted = formatUserInfoForPost(
      userInfo,
      post as Record<string, unknown>,
    );

    // 新しい投稿を最新タイムライン向けに配信
    broadcast({
      type: "newPost",
      payload: { timeline: "latest", post: formatted },
    });

    // ローカルのフォロワーへ個別に配信
    const account = await db.findAccountByUserName(author);
    const followers = account?.followers ?? [];
    const localFollowers = followers
      .map((url) => {
        try {
          const u = new URL(url);
          if (u.hostname !== domain || !u.pathname.startsWith("/users/")) {
            return null;
          }
          return `${u.pathname.split("/")[2]}@${domain}`;
        } catch {
          return null;
        }
      })
      .filter((v): v is string => !!v);
    // 投稿者自身にも送信
    localFollowers.push(`${author}@${domain}`);
    for (const f of localFollowers) {
      sendToUser(f, {
        type: "newPost",
        payload: { timeline: "following", post: formatted },
      });
    }

    return c.json(formatted, 201);
  },
);

app.get("/posts/:id", async (c) => {
  const domain = getDomain(c);
  const env = getEnv(c);
  const id = c.req.param("id");
  const db = createDB(env);
  const post = await db.getObject(id) as ActivityObject | null;
  if (!post) return c.json({ error: "Not found" }, 404);

  const postData = post as PostDoc;
  const userInfo = await getUserInfo(postData.actor_id as string, domain, env);
  const data = {
    _id: postData._id,
    content: postData.content,
    published: postData.published,
    extra: postData.extra,
  } as Record<string, unknown>;
  return c.json(formatUserInfoForPost(userInfo, data));
});

app.get("/posts/:id/replies", async (c) => {
  const domain = getDomain(c);
  const env = getEnv(c);
  const id = c.req.param("id");
  const db = createDB(env);
  const list = await db.findNotes({ "extra.inReplyTo": id }, {
    published: 1,
  }) as ActivityObject[];
  const ids = list.map((doc) => (doc as PostDoc).actor_id as string);
  const infos = await getUserInfoBatch(ids, domain, env);
  const formatted = list.map((doc, i) =>
    formatUserInfoForPost(infos[i], doc as Record<string, unknown>)
  );
  return c.json(formatted);
});

app.put(
  "/posts/:id",
  zValidator("json", z.object({ content: z.string() })),
  async (c) => {
    const domain = getDomain(c);
    const id = c.req.param("id");
    const { content } = c.req.valid("json") as { content: string };
    const env = getEnv(c);
    const db = createDB(env);
    const post = await db.updateNote(id, { content }) as ActivityObject | null;
    if (!post) return c.json({ error: "Not found" }, 404);

    // 共通ユーザー情報取得サービスを使用
    const postData = post as PostDoc;
    const userInfo = await getUserInfo(
      postData.actor_id as string,
      domain,
      env,
    );

    // 更新された投稿を FASP へ通知
    const objectUrl = `https://${domain}/objects/${id}`;
    await announceIfPublicAndDiscoverable(env, {
      category: "content",
      eventType: "update",
      objectUris: [objectUrl],
    }, post);

    return c.json(
      formatUserInfoForPost(
        userInfo,
        post as Record<string, unknown>,
      ),
    );
  },
);

app.post(
  "/posts/:id/like",
  zValidator("json", z.object({ username: z.string() })),
  async (c) => {
    const domain = getDomain(c);
    const id = c.req.param("id");
    const { username } = c.req.valid("json") as { username: string };
    const env = getEnv(c);
    const db = createDB(env);
    const post = await db.getObject(id) as ActivityObject | null;
    if (!post) return c.json({ error: "Not found" }, 404);

    const postData = post as PostDoc;
    const extra = (postData.extra as Record<string, unknown>) ?? {};
    const likedBy: string[] = Array.isArray(extra.likedBy)
      ? extra.likedBy as string[]
      : [];
    if (!likedBy.includes(username)) {
      likedBy.push(username);
      extra.likedBy = likedBy;
      extra.likes = likedBy.length;
      const env = getEnv(c);
      const db = createDB(env);
      await db.updateNote(id, { extra });

      const actorId = `https://${domain}/users/${username}`;
      const objectUrl = `https://${domain}/objects/${postData._id}`;
      let inboxes: string[] = [];
      if (
        typeof postData.actor_id === "string" &&
        !isLocalActor(postData.actor_id as string, domain)
      ) {
        const inbox = await fetchActorInbox(postData.actor_id as string, env);
        if (inbox) inboxes.push(inbox);
      } else if (typeof postData.actor_id === "string") {
        const url = new URL(postData.actor_id);
        const db = createDB(env);
        const account = await db.findAccountByUserName(
          url.pathname.split("/")[2],
        );
        inboxes = account?.followers ?? [];
      }
      if (inboxes.length > 0) {
        const like = createLikeActivity(domain, actorId, objectUrl);
        deliverActivityPubObject(inboxes, like, username, domain, env).catch(
          (err) => {
            console.error("Delivery failed:", err);
          },
        );
      }

      let localAuthor: string | null = null;
      if (
        typeof postData.actor_id === "string" &&
        isLocalActor(postData.actor_id, domain)
      ) {
        try {
          const url = new URL(postData.actor_id);
          localAuthor = url.pathname.split("/")[2];
        } catch {
          /* ignore */
        }
      }
      if (localAuthor) {
        await addNotification(
          "新しいいいね",
          `${username}さんが${localAuthor}さんの投稿をいいねしました`,
          "info",
          env,
        );
      }

      // いいね数の更新を FASP へ通知
      await announceIfPublicAndDiscoverable(env, {
        category: "content",
        eventType: "update",
        objectUris: [`https://${domain}/objects/${id}`],
      }, post);
    }

    return c.json({
      likes: (postData.extra as Record<string, unknown>)?.likes ?? 0,
    });
  },
);

app.post(
  "/posts/:id/retweet",
  zValidator("json", z.object({ username: z.string() })),
  async (c) => {
    const domain = getDomain(c);
    const id = c.req.param("id");
    const { username } = c.req.valid("json") as { username: string };
    const env = getEnv(c);
    const db = createDB(env);
    const post = await db.getObject(id) as ActivityObject | null;
    if (!post) return c.json({ error: "Not found" }, 404);

    const postData = post as PostDoc;
    const extra = postData.extra as Record<string, unknown>;
    const retweetedBy: string[] = Array.isArray(extra.retweetedBy)
      ? extra.retweetedBy as string[]
      : [];
    if (!retweetedBy.includes(username)) {
      retweetedBy.push(username);
      extra.retweetedBy = retweetedBy;
      extra.retweets = retweetedBy.length;
      const env = getEnv(c);
      const db = createDB(env);
      await db.updateNote(id, { extra });

      const actorId = `https://${domain}/users/${username}`;
      const objectUrl = `https://${domain}/objects/${postData._id}`;

      let inboxes: string[] = [];
      const account = await db.findAccountByUserName(username);
      inboxes = account?.followers ?? [];

      if (
        typeof postData.actor_id === "string" &&
        !isLocalActor(postData.actor_id, domain)
      ) {
        const inbox = await fetchActorInbox(postData.actor_id as string, env);
        if (inbox) inboxes.push(inbox);
      }

      if (inboxes.length > 0) {
        const announce = createAnnounceActivity(domain, actorId, objectUrl);
        deliverActivityPubObject(inboxes, announce, username, domain, env)
          .catch(
            (err) => {
              console.error("Delivery failed:", err);
            },
          );
      }

      let localAuthor: string | null = null;
      if (
        typeof postData.actor_id === "string" &&
        isLocalActor(postData.actor_id, domain)
      ) {
        try {
          const url = new URL(postData.actor_id);
          localAuthor = url.pathname.split("/")[2];
        } catch {
          /* ignore */
        }
      }
      if (localAuthor) {
        await addNotification(
          "新しいリツイート",
          `${username}さんが${localAuthor}さんの投稿をリツイートしました`,
          "info",
          env,
        );
      }

      // リツイート数の更新を FASP へ通知
      await announceIfPublicAndDiscoverable(env, {
        category: "content",
        eventType: "update",
        objectUris: [`https://${domain}/objects/${id}`],
      }, post);
    }

    return c.json({
      retweets: (postData.extra as Record<string, unknown>)?.retweets ?? 0,
    });
  },
);

app.delete("/posts/:id", async (c) => {
  const domain = getDomain(c);
  const env = getEnv(c);
  const db = createDB(env);
  const id = c.req.param("id");
  const post = await db.getObject(id) as ActivityObject | null;
  if (!post) return c.json({ error: "Not found" }, 404);
  const deleted = await db.deleteNote(id);
  if (!deleted) return c.json({ error: "Not found" }, 404);

  // 削除された投稿を FASP へ通知
  await announceIfPublicAndDiscoverable(env, {
    category: "content",
    eventType: "delete",
    objectUris: [`https://${domain}/objects/${id}`],
  }, post);

  return c.json({ success: true });
});

export default app;
