import { type Context, Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
type ActivityObject = Record<string, unknown>;
import { getDB } from "../db/mod.ts";
import type { DataStore } from "../db/types.ts";

// 型定義用のimport
import { getEnv } from "@takos/config";

type ActivityPubObjectType = ActivityObject;
import {
  createAnnounceActivity,
  createLikeActivity,
  deliverActivityPubObject,
  getDomain,
  iriToHandle,
  isLocalActor,
} from "../utils/activitypub.ts";
import authRequired from "../utils/auth.ts";
import {
  formatUserInfoForPost,
  getUserInfo,
  getUserInfoBatch,
} from "../services/user-info.ts";
import { addNotification } from "../services/notification.ts";
import { rateLimit } from "../utils/rate_limit.ts";
// import { announceIfPublicAndDiscoverable } from "../services/fasp.ts"; // FASP機能凍結
import {
  // announceToFasp,
  createPost,
  notifyFollowers,
} from "../services/posts.ts";

interface PostDoc {
  _id?: string;
  attributedTo?: string;
  actor_id?: string;
  content?: string;
  published?: string | Date;
  extra?: Record<string, unknown>;
}

async function findPost(
  db: DataStore,
  id: string,
): Promise<ActivityObject | null> {
  // 公開投稿（Note）のみを検索し、DM/チャット（Message）は除外
  return await db.posts.findNoteById(id) as ActivityObject | null;
}

const app = new Hono();
const auth = (c: Context, next: () => Promise<void>) => {
  const db = getDB(c);
  const middleware = authRequired(db);
  return middleware(c, next);
};
app.use("/posts/*", auth);

app.get("/posts", async (c) => {
  const domain = getDomain(c);
  const actor = c.req.query("actor");
  const timeline = c.req.query("timeline") ?? "latest";
  const limit = Math.min(
    parseInt(c.req.query("limit") ?? "50", 10) || 50,
    100,
  );
  const before = c.req.query("before");
  const db = getDB(c);
  let list: ActivityPubObjectType[];
  if (timeline === "following" && actor) {
    list = await db.posts.listTimeline(actor, {
      limit,
      before: before ? new Date(before) : undefined,
    }) as ActivityObject[];
  } else {
    list = await db.posts.getPublicNotes(
      limit,
      before ? new Date(before) : undefined,
    ) as ActivityObject[];
  }

  const accts = list.map((doc) => iriToHandle(doc.actor_id as string));
  const userInfos = await getUserInfoBatch(
    db,
    accts as string[],
    domain,
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
      // faspShare: z.boolean().optional(),
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
      // faspShare,
    } = c.req.valid("json") as {
      author: string;
      content: string;
      attachments?: unknown[];
      parentId?: string;
      quoteId?: string;
      // faspShare?: boolean;
    };

    const extra: Record<string, unknown> = { likes: 0, retweets: 0 };
    if (Array.isArray(attachments)) extra.attachments = attachments;
    if (typeof parentId === "string") extra.inReplyTo = parentId;
    if (typeof quoteId === "string") extra.quoteId = quoteId;
    if (typeof parentId === "string") extra.replies = 0;

    const _env = getEnv(c);
    const db = getDB(c);
    const { post, createActivity, objectId } = await createPost(
      db,
      domain,
      author,
      content,
      extra,
      parentId,
    );

    await notifyFollowers(
      _env,
      author,
      createActivity,
      domain,
      db,
      post,
      parentId,
      objectId,
    );

    // await announceToFasp(env, domain, post, objectId, db, faspShare); // FASP機能凍結

    const postData = post as PostDoc;
    const userInfo = await getUserInfo(
      db,
      iriToHandle(postData.actor_id as string),
      domain,
    );
    const formatted = formatUserInfoForPost(
      userInfo,
      post as Record<string, unknown>,
    );
    return c.json(formatted, 201);
  },
);

app.get("/posts/:id", async (c) => {
  const domain = getDomain(c);
  const id = c.req.param("id");
  const db = getDB(c);
  const post = await findPost(db, id);
  if (!post) return c.json({ error: "Not found" }, 404);

  const postData = post as PostDoc;
  const userInfo = await getUserInfo(
    db,
    iriToHandle(postData.actor_id as string),
    domain,
  );
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
  const id = c.req.param("id");
  const db = getDB(c);
  const list = await db.posts.findNotes({ "extra.inReplyTo": id }, {
    published: 1,
  }) as ActivityObject[];
  const ids = list.map((doc) =>
    iriToHandle((doc as PostDoc).actor_id as string)
  );
  const infos = await getUserInfoBatch(db, ids, domain);
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
    const _env = getEnv(c);
    const db = getDB(c);
    const post = await db.posts.updateNote(id, { content }) as
      | ActivityObject
      | null;
    if (!post) return c.json({ error: "Not found" }, 404);

    // 共通ユーザー情報取得サービスを使用
    const postData = post as PostDoc;
    const userInfo = await getUserInfo(
      db,
      iriToHandle(postData.actor_id as string),
      domain,
    );

    // 更新された投稿を FASP へ通知
    const _objectUrl = `https://${domain}/objects/${id}`;
    // await announceIfPublicAndDiscoverable(db, env, domain, {
    //   category: "content",
    //   eventType: "update",
    //   objectUris: [objectUrl],
    // }, post);

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
    const db = getDB(c);
    // 公開投稿（Note）のみを対象とし、DM/チャットは除外
    const post = await db.posts.findNoteById(id) as ActivityObject | null;
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
      const db = getDB(c);
      await db.posts.updateNote(id, { extra });

      const actorId = `https://${domain}/users/${username}`;
      const objectUrl = `https://${domain}/objects/${postData._id}`;
      let targets: string[] = [];
      if (
        typeof postData.actor_id === "string" &&
        !isLocalActor(postData.actor_id as string, domain)
      ) {
        targets.push(postData.actor_id as string);
      } else if (typeof postData.actor_id === "string") {
        const url = new URL(postData.actor_id);
        const db = getDB(c);
        const account = await db.accounts.findByUserName(
          url.pathname.split("/")[2],
        );
        targets = account?.followers ?? [];
      }
      if (targets.length > 0) {
        const like = createLikeActivity(domain, actorId, objectUrl);
        deliverActivityPubObject(targets, like, username, domain, db).catch(
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
          db,
          localAuthor,
          "新しいいいね",
          `${username}さんが${localAuthor}さんの投稿をいいねしました`,
          "info",
          env,
        );
      }

      // いいね数の更新を FASP へ通知
      // await announceIfPublicAndDiscoverable(db, env, domain, {
      //   category: "content",
      //   eventType: "update",
      //   objectUris: [`https://${domain}/objects/${id}`],
      // }, post);
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
    const db = getDB(c);
    // 公開投稿（Note）のみを対象とし、DM/チャットは除外
    const post = await db.posts.findNoteById(id) as ActivityObject | null;
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
      const db = getDB(c);
      await db.posts.updateNote(id, { extra });

      const actorId = `https://${domain}/users/${username}`;
      const objectUrl = `https://${domain}/objects/${postData._id}`;

      let targets: string[] = [];
      const account = await db.accounts.findByUserName(username);
      targets = account?.followers ?? [];

      if (
        typeof postData.actor_id === "string" &&
        !isLocalActor(postData.actor_id, domain)
      ) {
        targets.push(postData.actor_id as string);
      }

      if (targets.length > 0) {
        const announce = createAnnounceActivity(domain, actorId, objectUrl);
        deliverActivityPubObject(targets, announce, username, domain, db)
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
          db,
          localAuthor,
          "新しいリツイート",
          `${username}さんが${localAuthor}さんの投稿をリツイートしました`,
          "info",
          env,
        );
      }

      // リツイート数の更新を FASP へ通知
      // await announceIfPublicAndDiscoverable(db, env, domain, {
      //   category: "content",
      //   eventType: "update",
      //   objectUris: [`https://${domain}/objects/${id}`],
      // }, post);
    }

    return c.json({
      retweets: (postData.extra as Record<string, unknown>)?.retweets ?? 0,
    });
  },
);

app.delete("/posts/:id", async (c) => {
  const _domain = getDomain(c);
  const _env = getEnv(c);
  const db = getDB(c);
  const id = c.req.param("id");
  // 公開投稿（Note）のみを対象とし、DM/チャットは除外
  const post = await db.posts.findNoteById(id) as ActivityObject | null;
  if (!post) return c.json({ error: "Not found" }, 404);
  const deleted = await db.posts.deleteNote(id);
  if (!deleted) return c.json({ error: "Not found" }, 404);

  // 削除された投稿を FASP へ通知
  // await announceIfPublicAndDiscoverable(db, env, domain, {
  //   category: "content",
  //   eventType: "delete",
  //   objectUris: [`https://${domain}/objects/${id}`],
  // }, post);

  return c.json({ success: true });
});

export default app;
