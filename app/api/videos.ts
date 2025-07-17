import { Hono } from "hono";
import { upgradeWebSocket } from "hono/deno";
import { extname } from "@std/path";
import {
  createStorage,
  type ObjectStorage,
} from "./services/object-storage.ts";
import {
  findObjects,
  getObject,
  saveObject,
  updateObject,
} from "./services/unified_store.ts";
import Account from "./models/account.ts";
import authRequired from "./utils/auth.ts";
import { getEnv } from "./utils/env_store.ts";
import {
  buildActivityFromStored,
  createCreateActivity,
  createObjectId,
  deliverActivityPubObject,
  fetchActorInbox,
  getDomain,
} from "./utils/activitypub.ts";
import { getUserInfo, getUserInfoBatch } from "./services/user-info.ts";

let storage: ObjectStorage;
export function initVideoModule(env: Record<string, string>) {
  storage = createStorage(env);
}

// --- Helper Functions ---
async function deliverVideoToFollowers(
  env: Record<string, string>,
  video: {
    toObject: () => Record<string, unknown>;
    content?: unknown;
    published?: unknown;
    extra?: unknown;
    _id?: unknown;
  },
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
          return await fetchActorInbox(followerUrl, env);
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
      deliverActivityPubObject(
        validInboxes,
        activity,
        author,
        domain,
        env,
      );
    }
  } catch (err) {
    console.error("ActivityPub delivery error:", err);
  }
}

const app = new Hono();
app.use("/videos/*", authRequired);
app.use("/video-files/*", authRequired);

const videoUploadWs = upgradeWebSocket((c) => {
  const chunks: Uint8Array[] = [];
  let storageKey: string | undefined;
  let videoMetadata: {
    author: string;
    title: string;
    description: string;
    hashtagsStr: string;
    isShort: boolean;
    duration: string;
    originalName: string;
  } | undefined;

  return {
    onOpen(_evt, ws) {
      console.log("WebSocket connection opened");
      ws.send(JSON.stringify({ status: "ready for metadata" }));
    },
    onMessage(evt, ws) {
      // First message is assumed to be JSON metadata
      if (typeof evt.data === "string") {
        try {
          const data = JSON.parse(evt.data);
          if (data.type === "metadata" && data.payload) {
            videoMetadata = data.payload;

            if (!videoMetadata || !videoMetadata.originalName) {
              ws.close(1003, "Invalid metadata payload");
              return;
            }

            const ext = extname(videoMetadata.originalName) || ".mp4";
            storageKey = `${crypto.randomUUID()}${ext}`;

            ws.send(JSON.stringify({ status: "ready for binary" }));
            return;
          }
        } catch (_e) {
          ws.close(1003, "Invalid metadata format");
          return;
        }
      }

      // Subsequent messages are binary data
      if (evt.data instanceof ArrayBuffer) {
        if (storageKey) {
          chunks.push(new Uint8Array(evt.data));
        } else {
          ws.close(1003, "Not ready for binary data");
        }
      }
    },
    async onClose(_evt, _ws) {
      console.log("WebSocket connection closed");
      if (storageKey && videoMetadata && chunks.length > 0) {
        const data = new Uint8Array(chunks.reduce((a, b) => a + b.length, 0));
        let offset = 0;
        for (const cbuf of chunks) {
          data.set(cbuf, offset);
          offset += cbuf.length;
        }
        const stored = await storage.put(`videos/${storageKey}`, data);
        const videoUrl = stored.startsWith("http")
          ? stored
          : `/api/video-files/${storageKey}`;

        const domain = getDomain(c);
        const video = await saveObject(
          getEnv(c),
          {
            _id: createObjectId(domain),
            type: "Video",
            attributedTo: videoMetadata.author,
            content: videoMetadata.description,
            published: new Date(),
            extra: {
              title: videoMetadata.title,
              hashtags: videoMetadata.hashtagsStr
                ? videoMetadata.hashtagsStr.split(" ")
                : [],
              isShort: videoMetadata.isShort,
              duration: videoMetadata.duration || "",
              likes: 0,
              views: 0,
              thumbnail: `/api/placeholder/${
                videoMetadata.isShort ? "225/400" : "400/225"
              }`,
              videoUrl,
            },
            actor_id: `https://${domain}/users/${videoMetadata.author}`,
            aud: {
              to: ["https://www.w3.org/ns/activitystreams#Public"],
              cc: [],
            },
          },
        );
        deliverVideoToFollowers(
          getEnv(c),
          video,
          videoMetadata.author,
          domain,
        );
        console.log("Video metadata saved to database.");
      } else {
        console.log("Upload incomplete, cleaning up.");
      }
    },
    onError(evt, _ws) {
      console.error("WebSocket error:", evt);
    },
  };
});

app.get("/videos/upload", videoUploadWs);

app.get("/videos", async (c) => {
  const domain = getDomain(c);
  const env = getEnv(c);
  const list = await findObjects(env, { type: "Video" }, { published: -1 });

  const identifiers = list.map((doc) => doc.attributedTo as string);
  const infos = await getUserInfoBatch(identifiers, domain);

  const result = list.map((doc, idx) => {
    const info = infos[idx];
    const extra = doc.extra as Record<string, unknown>;
    return {
      id: String(doc._id),
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
      videoUrl: (extra.videoUrl as string) ?? "",
    };
  });

  return c.json(result);
});

app.post("/videos", async (c) => {
  const domain = getDomain(c);
  const contentType = c.req.header("content-type") || "";
  if (!contentType.includes("multipart/form-data")) {
    return c.json({ error: "Invalid content type" }, 400);
  }

  const form = await c.req.formData();
  const file = form.get("file");
  const author = form.get("author")?.toString();
  const title = form.get("title")?.toString();
  const description = form.get("description")?.toString() || "";
  const hashtagsStr = form.get("hashtags")?.toString() || "";
  const isShort = form.get("isShort")?.toString() === "true";
  const duration = form.get("duration")?.toString() || "";

  if (!(file instanceof File) || !author || !title) {
    return c.json({ error: "Invalid body" }, 400);
  }

  const ext = extname(file.name) || ".mp4";
  const filename = `${crypto.randomUUID()}${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const stored = await storage.put(`videos/${filename}`, bytes);
  const videoUrl = stored.startsWith("http")
    ? stored
    : `/api/video-files/${filename}`;

  const video = await saveObject(
    getEnv(c),
    {
      _id: createObjectId(domain),
      type: "Video",
      attributedTo: author,
      content: description,
      published: new Date(),
      extra: {
        title,
        hashtags: hashtagsStr ? hashtagsStr.split(" ") : [],
        isShort,
        duration: duration || "",
        likes: 0,
        views: 0,
        thumbnail: `/api/placeholder/${isShort ? "225/400" : "400/225"}`,
        videoUrl,
      },
      actor_id: `https://${domain}/users/${author}`,
      aud: { to: ["https://www.w3.org/ns/activitystreams#Public"], cc: [] },
    },
  );

  // Fire-and-forget delivery
  deliverVideoToFollowers(
    getEnv(c),
    video,
    author,
    domain,
  );

  const info = await getUserInfo(video.attributedTo as string, domain);

  return c.json({
    id: String(video._id),
    title,
    author: info.displayName,
    authorAvatar: info.authorAvatar,
    thumbnail: video.extra.thumbnail,
    duration: video.extra.duration,
    views: 0,
    likes: 0,
    timestamp: video.published,
    isShort: !!video.extra.isShort,
    description,
    hashtags: hashtagsStr ? hashtagsStr.split(" ") : [],
    videoUrl,
  }, 201);
});

app.post("/videos/:id/like", async (c) => {
  const id = c.req.param("id");
  const env = getEnv(c);
  const doc = await getObject(env, id);
  if (!doc) return c.json({ error: "Not found" }, 404);
  const extra = doc.extra as Record<string, unknown> ?? {};
  const likes = typeof extra.likes === "number" ? extra.likes + 1 : 1;
  extra.likes = likes;
  await updateObject(env, id, { extra });
  return c.json({ likes });
});

app.post("/videos/:id/view", async (c) => {
  const id = c.req.param("id");
  const env = getEnv(c);
  const doc = await updateObject(env, id, { $inc: { "extra.views": 1 } });
  if (!doc) return c.json({ error: "Not found" }, 404);
  const extra = (doc.extra ?? {}) as Record<string, unknown>;
  const views = typeof extra.views === "number" ? extra.views : 0;
  return c.json({ views });
});

app.get("/video-files/:name", async (c) => {
  const name = c.req.param("name");
  const data = await storage.get(`videos/${name}`);
  if (!data) return c.text("Not found", 404);
  const ext = extname(name).toLowerCase();
  const mime = ext === ".mp4"
    ? "video/mp4"
    : ext === ".webm"
    ? "video/webm"
    : "application/octet-stream";
  return new Response(data, { headers: { "Content-Type": mime } });
});

export default app;
