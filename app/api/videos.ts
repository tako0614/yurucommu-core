import { Hono } from "hono";
import type { Context } from "hono";
import {
  registerBinaryHandler,
  registerCloseHandler,
  registerMessageHandler,
  registerOpenHandler,
} from "./ws.ts";
import { extname } from "@std/path";
import {
  createStorage,
  type ObjectStorage,
} from "./services/object-storage.ts";
import { createDB } from "./db.ts";
import authRequired from "./utils/auth.ts";
import { getEnv } from "../../shared/config.ts";
import { rateLimit } from "./utils/rate_limit.ts";
import {
  buildActivityFromStored,
  createCreateActivity,
  getDomain,
} from "./utils/activitypub.ts";
import { deliverToFollowers } from "./utils/deliver.ts";
import { getUserInfo, getUserInfoBatch } from "./services/user-info.ts";

type VideoDoc = {
  _id: { toString(): string } | string;
  attributedTo: string;
  content?: string;
  published: string | Date;
  extra: Record<string, unknown>;
  toObject(): Record<string, unknown>;
};

let storage: ObjectStorage;
export async function initVideoModule(env: Record<string, string>) {
  const db = createDB(env);
  storage = await createStorage(env, db);
}

const app = new Hono();
app.use("/videos/*", authRequired);
app.use("/video-files/*", authRequired);

export function initVideoWebSocket() {
  registerOpenHandler((ws, state) => {
    state.chunks = [];
    state.storageKey = undefined;
    state.videoMetadata = undefined;
    ws.send(JSON.stringify({ status: "ready for metadata" }));
  });

  registerMessageHandler("metadata", (payload, ws, state) => {
    const data = payload as {
      author: string;
      title: string;
      description: string;
      hashtagsStr: string;
      isShort: boolean;
      duration: string;
      originalName: string;
    };

    if (!data || !data.originalName) {
      ws.close(1003, "Invalid metadata payload");
      return;
    }

    state.videoMetadata = data;
    const ext = extname(data.originalName) || ".mp4";
    state.storageKey = `${crypto.randomUUID()}${ext}`;
    ws.send(JSON.stringify({ status: "ready for binary" }));
  });

  registerBinaryHandler((payload, ws, state) => {
    const key = state.storageKey as string | undefined;
    if (key) {
      const chunks = state.chunks as Uint8Array[];
      chunks.push(new Uint8Array(payload as ArrayBuffer));
    } else {
      ws.close(1003, "Not ready for binary data");
    }
  });

  registerCloseHandler(async (_ws, state) => {
    const c = state.context as Context;
    const key = state.storageKey as string | undefined;
    const meta = state.videoMetadata as {
      author: string;
      title: string;
      description: string;
      hashtagsStr: string;
      isShort: boolean;
      duration: string;
      originalName: string;
    } | undefined;
    const chunks = state.chunks as Uint8Array[];
    if (key && meta && chunks.length > 0) {
      const data = new Uint8Array(chunks.reduce((a, b) => a + b.length, 0));
      let offset = 0;
      for (const cbuf of chunks) {
        data.set(cbuf, offset);
        offset += cbuf.length;
      }
      const stored = await storage.put(`videos/${key}`, data);
      const videoUrl = stored.startsWith("http")
        ? stored
        : `/api/video-files/${key}`;

      const domain = getDomain(c);
      const env = getEnv(c);
      const db = createDB(env);
      const video = await db.saveVideo(
        domain,
        meta.author,
        meta.description,
        {
          title: meta.title,
          hashtags: meta.hashtagsStr ? meta.hashtagsStr.split(" ") : [],
          isShort: meta.isShort,
          duration: meta.duration || "",
          likes: 0,
          views: 0,
          thumbnail: `/api/placeholder/${meta.isShort ? "225/400" : "400/225"}`,
          videoUrl,
        },
      ) as VideoDoc;

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
        meta.author,
        false,
      );
      const activity = createCreateActivity(
        domain,
        `https://${domain}/users/${meta.author}`,
        videoObject,
      );
      deliverToFollowers(getEnv(c), meta.author, activity, domain);
    }
  });
}

app.get("/videos", async (c) => {
  const domain = getDomain(c);
  const env = getEnv(c);
  const db = createDB(env);
  const list = await db.findVideos({}, { published: -1 }) as VideoDoc[];

  const identifiers = list.map((doc) => doc.attributedTo);
  const infos = await getUserInfoBatch(identifiers, domain, env);

  const result = list.map((doc, idx) => {
    const info = infos[idx];
    const extra = doc.extra;
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


app.post("/videos", rateLimit({ windowMs: 60_000, limit: 5 }), async (c) => {
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

  const env = getEnv(c);
  const db = createDB(env);
  const video = await db.saveVideo(
    domain,
    author,
    description,
    {
      title,
      hashtags: hashtagsStr ? hashtagsStr.split(" ") : [],
      isShort,
      duration: duration || "",
      likes: 0,
      views: 0,
      thumbnail: `/api/placeholder/${isShort ? "225/400" : "400/225"}`,
      videoUrl,
    },
  ) as VideoDoc;

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
  deliverToFollowers(getEnv(c), author, activity, domain);

  const info = await getUserInfo(video.attributedTo as string, domain, env);

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
  const db = createDB(env);
  const doc = await db.getObject(id) as VideoDoc | null;
  if (!doc) return c.json({ error: "Not found" }, 404);
  const extra = doc.extra ?? {} as Record<string, unknown>;
  const likes = typeof extra.likes === "number" ? extra.likes + 1 : 1;
  extra.likes = likes;
  await db.updateVideo(id, { extra });
  return c.json({ likes });
});

app.post("/videos/:id/view", async (c) => {
  const id = c.req.param("id");
  const env = getEnv(c);
  const db = createDB(env);
  const doc = await db.updateVideo(id, { $inc: { "extra.views": 1 } }) as
    | VideoDoc
    | null;
  if (!doc) return c.json({ error: "Not found" }, 404);
  const extra = doc.extra ?? {} as Record<string, unknown>;
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
