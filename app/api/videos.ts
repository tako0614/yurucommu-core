import { Hono } from "hono";
import ActivityPubObject from "./models/activitypub_object.ts";
import Account from "./models/account.ts";
import authRequired from "./utils/auth.ts";
import {
  buildActivityFromStored,
  createCreateActivity,
  deliverActivityPubObject,
  fetchActorInbox,
  getDomain,
} from "./utils/activitypub.ts";
import { getUserInfo, getUserInfoBatch } from "./services/user-info.ts";

// --- Helper Functions ---
async function deliverVideoToFollowers(
  video: ActivityPubObject & { toObject: () => Record<string, unknown> },
  author: string,
  domain: string,
) {
  try {
    const account = await Account.findOne({ userName: author }).lean();
    if (!account || !account.followers) return;

    const inboxes = await Promise.all(
      account.followers.map(async (followerUrl) => {
        try {
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

    const validInboxes = inboxes.filter((i): i is string =>
      typeof i === "string" && !!i
    );

    if (validInboxes.length > 0) {
      const baseObj = video.toObject();
      const videoObject = buildActivityFromStored(
        {
          ...baseObj,
          content: typeof video.content === "string" ? video.content : "",
          _id: String(baseObj._id),
          type: typeof baseObj.type === "string" ? baseObj.type : "Video",
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
      const activity = createCreateActivity(
        domain,
        `https://${domain}/users/${author}`,
        videoObject,
      );
      deliverActivityPubObject(validInboxes, activity, author);
    }
  } catch (err) {
    console.error("ActivityPub delivery error:", err);
  }
}

const app = new Hono();
app.use("*", authRequired);

app.get("/videos", async (c) => {
  const domain = getDomain(c);
  const list = await ActivityPubObject.find({ type: "Video" }).sort({
    published: -1,
  }).lean();

  const identifiers = list.map((doc) => doc.attributedTo as string);
  const infos = await getUserInfoBatch(identifiers, domain);

  const result = list.map((doc, idx) => {
    const info = infos[idx];
    const extra = doc.extra as Record<string, unknown>;
    return {
      id: doc._id.toString(),
      title: (extra.title as string) ?? "",
      author: info.displayName,
      authorAvatar: info.authorAvatar,
      thumbnail: (extra.thumbnail as string) ?? "",
      duration: (extra.duration as string) ?? "",
      views: typeof extra.views === "number" ? extra.views : 0,
      likes: typeof extra.likes === "number" ? extra.likes : 0,
      timestamp: doc.published,
      isShort: !!extra.isShort,
      description: doc.content ?? "",
      hashtags: Array.isArray(extra.hashtags) ? extra.hashtags as string[] : [],
    };
  });

  return c.json(result);
});

app.post("/videos", async (c) => {
  const domain = getDomain(c);
  const body = await c.req.json();
  const { author, title, description, hashtags, isShort, duration } = body;

  if (typeof author !== "string" || typeof title !== "string") {
    return c.json({ error: "Invalid body" }, 400);
  }

  const video = new ActivityPubObject({
    type: "Video",
    attributedTo: author,
    content: description || "",
    published: new Date(),
    extra: {
      title,
      hashtags,
      isShort: !!isShort,
      duration: duration || "",
      likes: 0,
      views: 0,
      thumbnail: `/api/placeholder/${isShort ? "225/400" : "400/225"}`,
    },
  });

  await video.save();

  // Fire-and-forget delivery
  deliverVideoToFollowers(video, author, domain);

  const info = await getUserInfo(video.attributedTo as string, domain);

  return c.json({
    id: video._id.toString(),
    title,
    author: info.displayName,
    authorAvatar: info.authorAvatar,
    thumbnail: video.extra.thumbnail,
    duration: video.extra.duration,
    views: 0,
    likes: 0,
    timestamp: video.published,
    isShort: !!video.extra.isShort,
    description: description || "",
    hashtags: Array.isArray(hashtags) ? hashtags : [],
  }, 201);
});

app.post("/videos/:id/like", async (c) => {
  const id = c.req.param("id");
  const doc = await ActivityPubObject.findById(id);
  if (!doc) return c.json({ error: "Not found" }, 404);
  const extra = doc.extra as Record<string, unknown>;
  const likes = typeof extra.likes === "number" ? extra.likes + 1 : 1;
  extra.likes = likes;
  doc.extra = extra;
  await doc.save();
  return c.json({ likes });
});

app.post("/videos/:id/view", async (c) => {
  const id = c.req.param("id");
  const doc = await ActivityPubObject.findByIdAndUpdate(
    id,
    { $inc: { "extra.views": 1 } },
    { new: true },
  ).lean();
  if (!doc) return c.json({ error: "Not found" }, 404);
  const extra = doc.extra as Record<string, unknown>;
  const views = typeof extra.views === "number" ? extra.views : 0;
  return c.json({ views });
});

export default app;
