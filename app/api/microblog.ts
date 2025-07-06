import { Hono } from "hono";
import ActivityPubObject from "./models/activitypub_object.ts";
import Account from "./models/account.ts";
import {
  buildActivityFromStored,
  createCreateActivity,
  createLikeActivity,
  deliverActivityPubObject,
  fetchActorInbox,
  getDomain,
} from "./utils/activitypub.ts";
import {
  formatUserInfoForPost,
  getUserInfo,
  getUserInfoBatch,
} from "./services/user-info.ts";

// --- Helper Functions ---

async function deliverPostToFollowers(
  post: ActivityPubObject,
  author: string,
  domain: string,
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

    const validInboxes = followerInboxes.filter((inbox): inbox is string => !!inbox);

    if (validInboxes.length > 0) {
      const noteObject = buildActivityFromStored(
        { ...post.toObject(), content: post.content ?? "" },
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
    }
  } catch (err) {
    console.error("ActivityPub delivery error:", err);
  }
}

// --- Hono App ---

const app = new Hono();

app.get("/microblog", async (c) => {
  const domain = getDomain(c);
  const list = await ActivityPubObject.find({ type: "Note" }).sort({
    published: -1,
  }).lean();

  // ユーザー情報をバッチで取得
  const identifiers = list.map((doc) => doc.attributedTo as string);
  const userInfos = await getUserInfoBatch(identifiers, domain);

  const formatted = list.map((doc: Record<string, unknown>, index: number) => {
    const userInfo = userInfos[index];
    return formatUserInfoForPost(userInfo, doc);
  });

  return c.json(formatted);
});

app.post("/microblog", async (c) => {
  const domain = getDomain(c);
  const { author, content } = await c.req.json();
  if (typeof author !== "string" || typeof content !== "string") {
    return c.json({ error: "Invalid body" }, 400);
  }

  const post = new ActivityPubObject({
    type: "Note",
    attributedTo: author,
    content,
    extra: { likes: 0, retweets: 0 },
  });
  await post.save();

  // Fire-and-forget the delivery process
  deliverPostToFollowers(post, author, domain);

  const userInfo = await getUserInfo(post.attributedTo as string, domain);
  return c.json(formatUserInfoForPost(userInfo, post), 201);
});

app.get("/microblog/:id", async (c) => {
  const domain = getDomain(c);
  const id = c.req.param("id");
  const post = await ActivityPubObject.findById(id).lean();
  if (!post) return c.json({ error: "Not found" }, 404);

  // 共通ユーザー情報取得サービスを使用
  const userInfo = await getUserInfo(post.attributedTo as string, domain);

  return c.json(formatUserInfoForPost(userInfo, post));
});

app.put("/microblog/:id", async (c) => {
  const domain = getDomain(c);
  const id = c.req.param("id");
  const { content } = await c.req.json();
  if (typeof content !== "string") {
    return c.json({ error: "Invalid body" }, 400);
  }
  const post = await ActivityPubObject.findByIdAndUpdate(id, { content }, {
    new: true,
  });
  if (!post) return c.json({ error: "Not found" }, 404);

  // 共通ユーザー情報取得サービスを使用
  const userInfo = await getUserInfo(post.attributedTo as string, domain);

  return c.json(formatUserInfoForPost(userInfo, post));
});

app.post("/microblog/:id/like", async (c) => {
  const domain = getDomain(c);
  const id = c.req.param("id");
  const { username } = await c.req.json();
  if (typeof username !== "string") {
    return c.json({ error: "Invalid body" }, 400);
  }
  const post = await ActivityPubObject.findById(id);
  if (!post) return c.json({ error: "Not found" }, 404);

  const extra = post.extra as Record<string, unknown>;
  const likedBy: string[] = Array.isArray(extra.likedBy)
    ? extra.likedBy as string[]
    : [];
  if (!likedBy.includes(username)) {
    likedBy.push(username);
    extra.likedBy = likedBy;
    extra.likes = likedBy.length;
    post.extra = extra;
    await post.save();

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
  }

  return c.json({ likes: (post.extra as Record<string, unknown>)?.likes ?? 0 });
});

app.post("/microblog/:id/retweet", async (c) => {
  const id = c.req.param("id");
  const post = await ActivityPubObject.findByIdAndUpdate(id, {
    $inc: { "extra.retweets": 1 },
  }, { new: true });
  if (!post) return c.json({ error: "Not found" }, 404);
  return c.json({
    retweets: (post.extra as Record<string, unknown>)?.retweets ?? 0,
  });
});

app.delete("/microblog/:id", async (c) => {
  const id = c.req.param("id");
  const post = await ActivityPubObject.findByIdAndDelete(id);
  if (!post) return c.json({ error: "Not found" }, 404);
  return c.json({ success: true });
});

export default app;
