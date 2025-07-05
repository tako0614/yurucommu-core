import { Hono } from "hono";
import ActivityPubObject from "./models/activitypub_object.ts";
import Account from "./models/account.ts";
import {
  buildActivityFromStored,
  deliverActivityPubObject,
  fetchActorInbox,
  getDomain,
} from "./utils/activitypub.ts";

const app = new Hono();

app.get("/microblog", async (c) => {
  const domain = getDomain(c);
  const list = await ActivityPubObject.find({ type: "Note" }).sort({
    published: -1,
  }).lean();
  const formatted = await Promise.all(
    list.map(async (doc: Record<string, unknown>) => {
      const account = await Account.findOne({ userName: doc.attributedTo })
        .lean();
      // attributedToがURLならそこからドメイン抽出
      let userName = doc.attributedTo;
      let postDomain = domain;
      if (typeof userName === "string" && userName.startsWith("http")) {
        try {
          postDomain = new URL(userName).host;
        } catch {}
      }
      return {
        id: typeof doc._id === "string"
          ? doc._id
          : typeof doc._id === "object" && doc._id !== null &&
              "toString" in doc._id
          ? (doc._id as { toString: () => string }).toString()
          : "",
        userName: doc.attributedTo,
        displayName: account?.displayName || doc.attributedTo,
        authorAvatar: account?.avatarInitial || "",
        content: doc.content,
        createdAt: doc.published,
        likes: (doc.extra as Record<string, unknown>)?.likes ?? 0,
        retweets: (doc.extra as Record<string, unknown>)?.retweets ?? 0,
        domain: postDomain,
      };
    }),
  );
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
  try {
    const account = await Account.findOne({ userName: author }).lean();
    const followers = account?.followers ?? [];
    const inboxes: string[] = [];
    for (const f of followers) {
      try {
        const url = new URL(f);
        if (url.host === domain && url.pathname.startsWith("/users/")) {
          continue;
        }
        const inbox = await fetchActorInbox(f);
        if (inbox) inboxes.push(inbox);
      } catch (_) {
        continue;
      }
    }
    if (inboxes.length > 0) {
      const activity = buildActivityFromStored(
        { ...post.toObject(), content: post.content ?? "" },
        domain,
        author,
        true,
      );
      deliverActivityPubObject(inboxes, activity, author).catch((err) => {
        console.error("Delivery failed:", err);
      });
    }
  } catch (err) {
    console.error("activitypub delivery error:", err);
  }
  const account = await Account.findOne({ userName: post.attributedTo }).lean();
  return c.json({
    id: post._id.toString(),
    userName: post.attributedTo,
    displayName: account?.displayName || post.attributedTo,
    authorAvatar: account?.avatarInitial || "",
    content: post.content,
    createdAt: post.published,
    likes: (post.extra as Record<string, unknown>)?.likes ?? 0,
    retweets: (post.extra as Record<string, unknown>)?.retweets ?? 0,
    domain,
  }, 201);
});

app.get("/microblog/:id", async (c) => {
  const domain = getDomain(c);
  const id = c.req.param("id");
  const post = await ActivityPubObject.findById(id).lean();
  if (!post) return c.json({ error: "Not found" }, 404);
  const account = await Account.findOne({ userName: post.attributedTo }).lean();
  return c.json({
    id: post._id.toString(),
    userName: post.attributedTo,
    displayName: account?.displayName || post.attributedTo,
    authorAvatar: account?.avatarInitial || "",
    content: post.content,
    createdAt: post.published,
    likes: (post.extra as Record<string, unknown>)?.likes ?? 0,
    retweets: (post.extra as Record<string, unknown>)?.retweets ?? 0,
    domain,
  });
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
  const account = await Account.findOne({ userName: post.attributedTo }).lean();
  return c.json({
    id: post._id.toString(),
    userName: post.attributedTo,
    displayName: account?.displayName || post.attributedTo,
    authorAvatar: account?.avatarInitial || "",
    content: post.content,
    createdAt: post.published,
    likes: (post.extra as Record<string, unknown>)?.likes ?? 0,
    retweets: (post.extra as Record<string, unknown>)?.retweets ?? 0,
    domain,
  });
});

app.post("/microblog/:id/like", async (c) => {
  const id = c.req.param("id");
  const post = await ActivityPubObject.findByIdAndUpdate(id, {
    $inc: { "extra.likes": 1 },
  }, { new: true });
  if (!post) return c.json({ error: "Not found" }, 404);
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
