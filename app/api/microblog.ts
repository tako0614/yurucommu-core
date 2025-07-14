import { Hono } from "hono";
import {
  deleteObject,
  findObjects,
  getObject,
  getPublicNotes,
  getTimeline,
  saveNote,
  updateObject,
} from "./services/unified_store.ts";

// 型定義用のimport
import type { InferSchemaType } from "mongoose";
import type { activityPubObjectSchema } from "./models/activitypub_object.ts";

type ActivityPubObjectType = InferSchemaType<typeof activityPubObjectSchema>;
import Account from "./models/account.ts";
import {
  buildActivityFromStored,
  createAnnounceActivity,
  createCreateActivity,
  createLikeActivity,
  deliverActivityPubObject,
  fetchActorInbox,
  getDomain,
} from "./utils/activitypub.ts";
import authRequired from "./utils/auth.ts";
import {
  formatUserInfoForPost,
  getUserInfo,
  getUserInfoBatch,
} from "./services/user-info.ts";
import { addNotification } from "./services/notification.ts";

// --- Helper Functions ---

async function deliverPostToFollowers(
  post: ActivityPubObjectType & { toObject: () => Record<string, unknown> },
  author: string,
  domain: string,
  replyToId?: string,
) {
  try {
    const account = await Account.findOne({ userName: author }).lean();
    if (!account || !account.followers) return;

    const followerInboxes = await Promise.all(
      account.followers.map(async (followerUrl) => {
        try {
          // Avoid delivering to local users via HTTP
          const url = new URL(followerUrl);
          if (url.host === domain && url.pathname.startsWith("/users/")) {
            return null;
          }
          return await fetchActorInbox(followerUrl);
        } catch {
          return null;
        }
      }),
    );

    const validInboxes = followerInboxes.filter((inbox): inbox is string =>
      typeof inbox === "string" && !!inbox
    );

    if (validInboxes.length > 0) {
      const baseObj = post.toObject();
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
      // Fire-and-forget delivery
      deliverActivityPubObject(validInboxes, createActivity, author);

      if (replyToId) {
        const parent = await getObject(replyToId);
        if (
          parent &&
          typeof parent.attributedTo === "string" &&
          parent.attributedTo.startsWith("http")
        ) {
          const inbox = await fetchActorInbox(parent.attributedTo);
          if (inbox) {
            deliverActivityPubObject([inbox], createActivity, author);
          }
        } else if (
          parent &&
          typeof parent.attributedTo === "string" &&
          parent.attributedTo !== author
        ) {
          await addNotification(
            "新しい返信",
            `${author}さんが${parent.attributedTo}さんの投稿に返信しました`,
          );
        }
      }
    }
  } catch (err) {
    console.error("ActivityPub delivery error:", err);
  }
}

// --- Hono App ---

const app = new Hono();
app.use("*", authRequired);

app.get("/microblog", async (c) => {
  const domain = getDomain(c);
  const env = c.get("env") as Record<string, string>;
  const tenantId = env["ACTIVITYPUB_DOMAIN"] ?? "";
  const actor = c.req.query("actor");
  const limit = Math.min(
    parseInt(c.req.query("limit") ?? "50", 10) || 50,
    100,
  );
  const before = c.req.query("before");
  let list;
  if (actor && tenantId) {
    list = await getTimeline(
      tenantId,
      actor,
      limit,
      before ? new Date(before) : undefined,
    );
  } else {
    list = await getPublicNotes(
      limit,
      before ? new Date(before) : undefined,
    );
  }

  const identifiers = list.map((doc) => doc.actor_id);
  const userInfos = await getUserInfoBatch(identifiers, domain);
  const formatted = list.map((doc, index) => {
    const userInfo = userInfos[index];
    const postData = { ...doc.raw, _id: doc._id } as Record<string, unknown>;
    return formatUserInfoForPost(userInfo, postData);
  });

  return c.json(formatted);
});

app.post("/microblog", async (c) => {
  const domain = getDomain(c);
  const {
    author,
    content,
    attachments,
    parentId,
    quoteId,
  } = await c.req.json();

  if (typeof author !== "string" || typeof content !== "string") {
    return c.json({ error: "Invalid body" }, 400);
  }

  const extra: Record<string, unknown> = { likes: 0, retweets: 0 };
  if (Array.isArray(attachments)) extra.attachments = attachments;
  if (typeof parentId === "string") extra.inReplyTo = parentId;
  if (typeof quoteId === "string") extra.quoteId = quoteId;
  if (typeof parentId === "string") extra.replies = 0;

  const env = c.get("env") as Record<string, string>;
  const post = await saveNote(env, domain, author, content, extra);

  if (typeof parentId === "string") {
    await updateObject(parentId, { $inc: { "extra.replies": 1 } }).catch(
      () => {},
    );
  }

  deliverPostToFollowers(
    post,
    author,
    domain,
    typeof parentId === "string" ? parentId : undefined,
  );

  const userInfo = await getUserInfo(post.attributedTo as string, domain);
  return c.json(formatUserInfoForPost(userInfo, post.toObject()), 201);
});

app.get("/microblog/:id", async (c) => {
  const domain = getDomain(c);
  const id = c.req.param("id");
  const post = await getObject(id);
  if (!post) return c.json({ error: "Not found" }, 404);

  const userInfo = await getUserInfo(post.actor_id as string, domain);
  const data = { ...post.raw, _id: post._id } as Record<string, unknown>;
  return c.json(formatUserInfoForPost(userInfo, data));
});

app.get("/microblog/:id/replies", async (c) => {
  const domain = getDomain(c);
  const id = c.req.param("id");
  const list = await findObjects({ "extra.inReplyTo": id }, { published: 1 });
  const ids = list.map((doc: ActivityPubObjectType) =>
    doc.attributedTo as string
  );
  const infos = await getUserInfoBatch(ids, domain);
  const formatted = list.map((doc: ActivityPubObjectType, i: number) =>
    formatUserInfoForPost(infos[i], doc)
  );
  return c.json(formatted);
});

app.put("/microblog/:id", async (c) => {
  const domain = getDomain(c);
  const id = c.req.param("id");
  const { content } = await c.req.json();
  if (typeof content !== "string") {
    return c.json({ error: "Invalid body" }, 400);
  }
  const post = await updateObject(id, { content });
  if (!post) return c.json({ error: "Not found" }, 404);

  // 共通ユーザー情報取得サービスを使用
  const userInfo = await getUserInfo(post.attributedTo as string, domain);

  return c.json(formatUserInfoForPost(userInfo, post.toObject()));
});

app.post("/microblog/:id/like", async (c) => {
  const domain = getDomain(c);
  const id = c.req.param("id");
  const { username } = await c.req.json();
  if (typeof username !== "string") {
    return c.json({ error: "Invalid body" }, 400);
  }
  const post = await getObject(id);
  if (!post) return c.json({ error: "Not found" }, 404);

  const extra = post.extra as Record<string, unknown> ?? {};
  const likedBy: string[] = Array.isArray(extra.likedBy)
    ? extra.likedBy as string[]
    : [];
  if (!likedBy.includes(username)) {
    likedBy.push(username);
    extra.likedBy = likedBy;
    extra.likes = likedBy.length;
    await updateObject(id, { extra });

    const actorId = `https://${domain}/users/${username}`;
    const objectUrl = typeof post.raw?.id === "string"
      ? post.raw.id as string
      : `https://${domain}/objects/${post._id}`;
    let inboxes: string[] = [];
    if (
      typeof post.attributedTo === "string" &&
      post.attributedTo.startsWith("http")
    ) {
      const inbox = await fetchActorInbox(post.attributedTo as string);
      if (inbox) inboxes.push(inbox);
    } else {
      const account = await Account.findOne({ userName: post.attributedTo })
        .lean();
      inboxes = account?.followers ?? [];
    }
    if (inboxes.length > 0) {
      const like = createLikeActivity(domain, actorId, objectUrl);
      deliverActivityPubObject(inboxes, like, username).catch((err) => {
        console.error("Delivery failed:", err);
      });
    }

    let localAuthor: string | null = null;
    if (typeof post.attributedTo === "string") {
      if (post.attributedTo.startsWith("http")) {
        try {
          const url = new URL(post.attributedTo);
          if (url.hostname === domain && url.pathname.startsWith("/users/")) {
            localAuthor = url.pathname.split("/")[2];
          }
        } catch {
          /* ignore */
        }
      } else {
        localAuthor = post.attributedTo;
      }
    }
    if (localAuthor) {
      await addNotification(
        "新しいいいね",
        `${username}さんが${localAuthor}さんの投稿をいいねしました`,
      );
    }
  }

  return c.json({ likes: (post.extra as Record<string, unknown>)?.likes ?? 0 });
});

app.post("/microblog/:id/retweet", async (c) => {
  const domain = getDomain(c);
  const id = c.req.param("id");
  const { username } = await c.req.json();
  if (typeof username !== "string") {
    return c.json({ error: "Invalid body" }, 400);
  }
  const post = await getObject(id);
  if (!post) return c.json({ error: "Not found" }, 404);

  const extra = post.extra as Record<string, unknown>;
  const retweetedBy: string[] = Array.isArray(extra.retweetedBy)
    ? extra.retweetedBy as string[]
    : [];
  if (!retweetedBy.includes(username)) {
    retweetedBy.push(username);
    extra.retweetedBy = retweetedBy;
    extra.retweets = retweetedBy.length;
    await updateObject(id, { extra });

    const actorId = `https://${domain}/users/${username}`;
    const objectUrl = typeof post.raw?.id === "string"
      ? post.raw.id as string
      : `https://${domain}/objects/${post._id}`;

    let inboxes: string[] = [];
    const account = await Account.findOne({ userName: username }).lean();
    inboxes = account?.followers ?? [];

    if (
      typeof post.attributedTo === "string" &&
      post.attributedTo.startsWith("http")
    ) {
      const inbox = await fetchActorInbox(post.attributedTo as string);
      if (inbox) inboxes.push(inbox);
    }

    if (inboxes.length > 0) {
      const announce = createAnnounceActivity(domain, actorId, objectUrl);
      deliverActivityPubObject(inboxes, announce, username).catch((err) => {
        console.error("Delivery failed:", err);
      });
    }

    let localAuthor: string | null = null;
    if (typeof post.attributedTo === "string") {
      if (post.attributedTo.startsWith("http")) {
        try {
          const url = new URL(post.attributedTo);
          if (url.hostname === domain && url.pathname.startsWith("/users/")) {
            localAuthor = url.pathname.split("/")[2];
          }
        } catch {
          /* ignore */
        }
      } else {
        localAuthor = post.attributedTo;
      }
    }
    if (localAuthor) {
      await addNotification(
        "新しいリツイート",
        `${username}さんが${localAuthor}さんの投稿をリツイートしました`,
      );
    }
  }

  return c.json({
    retweets: (post.extra as Record<string, unknown>)?.retweets ?? 0,
  });
});

app.delete("/microblog/:id", async (c) => {
  const id = c.req.param("id");
  const deleted = await deleteObject(id);
  if (!deleted) return c.json({ error: "Not found" }, 404);
  return c.json({ success: true });
});

export default app;
