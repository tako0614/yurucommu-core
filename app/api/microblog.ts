import { Hono } from "hono";
import ActivityPubObject from "./models/activitypub_object.ts";
import Account from "./models/account.ts";
import {
  buildActivityFromStored,
  deliverActivityPubObject,
  fetchActorInbox,
  getDomain,
} from "./utils/activitypub.ts";
import {
  getUserInfo,
  getUserInfoBatch,
  formatUserInfoForPost,
} from "./services/user-info.ts";

const app = new Hono();


app.get("/microblog", async (c) => {
  const domain = getDomain(c);
  const list = await ActivityPubObject.find({ type: "Note" }).sort({
    published: -1,
  }).lean();
  
  // ユーザー情報をバッチで取得
  const identifiers = list.map(doc => doc.attributedTo as string);
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
  
  // 共通ユーザー情報取得サービスを使用
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
