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
      // ローカルユーザーの場合はDBから取得
      const account = await Account.findOne({ userName: doc.attributedTo })
        .lean();
      
      let userName = doc.attributedTo as string;
      let displayName = userName;
      let authorAvatar = "";
      let postDomain = domain;
      
      if (account) {
        // ローカルユーザーの場合
        displayName = account.displayName || userName;
        authorAvatar = account.avatarInitial || "";
      } else if (typeof userName === "string" && userName.startsWith("http")) {
        // 外部ユーザーの場合（ActivityPub URL）
        try {
          const url = new URL(userName);
          postDomain = url.hostname;
          
          // URLから適切なユーザー名を抽出
          const pathParts = url.pathname.split("/");
          const extractedUsername = pathParts[pathParts.length - 1] || 
                                   pathParts[pathParts.length - 2] || 
                                   "external_user";
          
          userName = extractedUsername;
          displayName = extractedUsername; // 外部ユーザーの場合、displayNameは後で取得する仕組みが必要
          
          // ActivityPubオブジェクトの追加情報から取得を試みる
          if (doc.extra && typeof doc.extra === "object") {
            const extra = doc.extra as Record<string, unknown>;
            if (extra.actorInfo && typeof extra.actorInfo === "object") {
              const actorInfo = extra.actorInfo as Record<string, unknown>;
              displayName = (actorInfo.name as string) || 
                           (actorInfo.preferredUsername as string) || 
                           displayName;
              authorAvatar = (actorInfo.icon as string) || "";
            }
          }
        } catch {
          postDomain = "external";
        }
      }
      
      return {
        id: typeof doc._id === "string"
          ? doc._id
          : typeof doc._id === "object" && doc._id !== null &&
              "toString" in doc._id
          ? (doc._id as { toString: () => string }).toString()
          : "",
        userName: userName,
        displayName: displayName,
        authorAvatar: authorAvatar,
        content: doc.content,
        createdAt: doc.published,
        likes: (doc.extra as Record<string, unknown>)?.likes ?? 0,
        retweets: (doc.extra as Record<string, unknown>)?.retweets ?? 0,
        replies: (doc.extra as Record<string, unknown>)?.replies ?? 0,
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
  
  const userName = post.attributedTo as string;
  let displayName = userName;
  let authorAvatar = "";
  
  if (account) {
    displayName = account.displayName || userName;
    authorAvatar = account.avatarInitial || "";
  }
  
  return c.json({
    id: post._id.toString(),
    userName: userName,
    displayName: displayName,
    authorAvatar: authorAvatar,
    content: post.content,
    createdAt: post.published,
    likes: (post.extra as Record<string, unknown>)?.likes ?? 0,
    retweets: (post.extra as Record<string, unknown>)?.retweets ?? 0,
    replies: (post.extra as Record<string, unknown>)?.replies ?? 0,
    domain,
  }, 201);
});

app.get("/microblog/:id", async (c) => {
  const domain = getDomain(c);
  const id = c.req.param("id");
  const post = await ActivityPubObject.findById(id).lean();
  if (!post) return c.json({ error: "Not found" }, 404);
  
  const account = await Account.findOne({ userName: post.attributedTo }).lean();
  
  const userName = post.attributedTo as string;
  let displayName = userName;
  let authorAvatar = "";
  
  if (account) {
    displayName = account.displayName || userName;
    authorAvatar = account.avatarInitial || "";
  }
  
  return c.json({
    id: post._id.toString(),
    userName: userName,
    displayName: displayName,
    authorAvatar: authorAvatar,
    content: post.content,
    createdAt: post.published,
    likes: (post.extra as Record<string, unknown>)?.likes ?? 0,
    retweets: (post.extra as Record<string, unknown>)?.retweets ?? 0,
    replies: (post.extra as Record<string, unknown>)?.replies ?? 0,
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
  
  const userName = post.attributedTo as string;
  let displayName = userName;
  let authorAvatar = "";
  
  if (account) {
    displayName = account.displayName || userName;
    authorAvatar = account.avatarInitial || "";
  }
  
  return c.json({
    id: post._id.toString(),
    userName: userName,
    displayName: displayName,
    authorAvatar: authorAvatar,
    content: post.content,
    createdAt: post.published,
    likes: (post.extra as Record<string, unknown>)?.likes ?? 0,
    retweets: (post.extra as Record<string, unknown>)?.retweets ?? 0,
    replies: (post.extra as Record<string, unknown>)?.replies ?? 0,
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
