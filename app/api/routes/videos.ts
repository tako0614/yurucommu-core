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
} from "../services/object-storage.ts";
import { createDB } from "../DB/mod.ts";
import authRequired from "../utils/auth.ts";
import { getEnv } from "../../shared/config.ts";
import { rateLimit } from "../utils/rate_limit.ts";
import {
  buildActivityFromStored,
  createCreateActivity,
  getDomain,
} from "../utils/activitypub.ts";
import { deliverToFollowers } from "../utils/deliver.ts";
import { getUserInfo, getUserInfoBatch } from "../services/user-info.ts";

type VideoDoc = {
  _id: { toString(): string } | string;
  attributedTo: string;
  content?: string;
  published: string | Date;
  extra: Record<string, unknown>;
};

let storage: ObjectStorage;
export async function initVideoModule(env: Record<string, string>) {
  const db = createDB(env);
  storage = await createStorage(env, db);
}

type UploadMeta = {
  author: string;
  title: string;
  description: string;
  hashtagsStr: string;
  isShort: boolean;
  duration: string;
  originalName: string;
  thumbnail?: string;
  thumbnailFile?: Uint8Array;
};

async function saveVideoBytes(c: Context, bytes: Uint8Array, meta: UploadMeta) {
  const env = getEnv(c);
  const domain = getDomain(c);
  const ext = extname(meta.originalName) || ".mp4";
  const filename = `${crypto.randomUUID()}${ext}`;
  const stored = await storage.put(`videos/${filename}`, bytes);
  let videoUrl = stored.startsWith("http")
    ? stored
    : `/api/video-files/${filename}`;

  let thumbnailUrl = `/api/placeholder/${meta.isShort ? "225/400" : "400/225"}`;
  if (meta.thumbnailFile || meta.thumbnail) {
    let bytesThumb: Uint8Array | null = null;
    let extThumb = ".png";
    if (meta.thumbnailFile) {
      bytesThumb = meta.thumbnailFile;
    } else if (meta.thumbnail) {
      try {
        const idx = meta.thumbnail.indexOf(",");
        const dataPart = idx >= 0
          ? meta.thumbnail.slice(idx + 1)
          : meta.thumbnail;
        const mimePart = idx >= 0 ? meta.thumbnail.slice(0, idx) : "";
        const match = /image\/([\w+.-]+)/.exec(mimePart);
        if (match) extThumb = `.${match[1].split("+")[0]}`;
        const bin = atob(dataPart);
        bytesThumb = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytesThumb[i] = bin.charCodeAt(i);
      } catch {
        bytesThumb = null;
      }
    }
    if (bytesThumb) {
      const nameT = `${crypto.randomUUID()}${extThumb}`;
      const storedT = await storage.put(
        `videos/thumbnails/${nameT}`,
        bytesThumb,
      );
      thumbnailUrl = storedT.startsWith("http")
        ? storedT
        : `/api/video-thumbnails/${nameT}`;
    }
  }

  if (!videoUrl.startsWith("http")) {
    videoUrl = `https://${domain}${videoUrl}`;
  }
  if (!thumbnailUrl.startsWith("http")) {
    thumbnailUrl = `https://${domain}${thumbnailUrl}`;
  }

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
      thumbnail: thumbnailUrl,
      videoUrl,
    },
  ) as VideoDoc;

  const baseObj = video as Record<string, unknown>;
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
  deliverToFollowers(env, meta.author, activity, domain);

  return { video, videoUrl };
}

const app = new Hono();
app.use("/videos/*", authRequired);
app.use("/video-files/*", authRequired);

export function initVideoWebSocket() {
  registerOpenHandler((ws, state) => {
    state.chunks = [];
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
      thumbnail?: string;
    };

    if (!data || !data.originalName) {
      ws.close(1003, "Invalid metadata payload");
      return;
    }

    state.videoMetadata = data;
    ws.send(JSON.stringify({ status: "ready for binary" }));
  });

  registerBinaryHandler((payload, _ws, state) => {
    const chunks = state.chunks as Uint8Array[];
    chunks.push(new Uint8Array(payload as ArrayBuffer));
  });

  registerCloseHandler(async (_ws, state) => {
    const c = state.context as Context;
    const meta = state.videoMetadata as UploadMeta | undefined;
    const chunks = state.chunks as Uint8Array[];
    if (meta && chunks.length > 0) {
      const data = new Uint8Array(chunks.reduce((a, b) => a + b.length, 0));
      let offset = 0;
      for (const cbuf of chunks) {
        data.set(cbuf, offset);
        offset += cbuf.length;
      }
      await saveVideoBytes(c, data, meta);
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
  const thumbnail = form.get("thumbnail");

  if (!(file instanceof File) || !author || !title) {
    return c.json({ error: "Invalid body" }, 400);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  let thumbBytes: Uint8Array | undefined;
  if (thumbnail instanceof File) {
    thumbBytes = new Uint8Array(await thumbnail.arrayBuffer());
  }
  const { video, videoUrl } = await saveVideoBytes(c, bytes, {
    author,
    title,
    description,
    hashtagsStr,
    isShort,
    duration,
    originalName: file.name,
    thumbnailFile: thumbBytes,
  });

  const env = getEnv(c);
  const info = await getUserInfo(video.attributedTo as string, domain, env);

  return c.json({
    id: String(video._id),
    title,
    author: info.displayName,
    authorAvatar: info.authorAvatar,
    thumbnail: video.extra.thumbnail,
    duration: video.extra.duration,
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
  const range = c.req.header("range");
  if (range) {
    const match = /bytes=(\d+)-(\d+)?/.exec(range);
    if (match) {
      const start = Number(match[1]);
      const end = match[2] ? Number(match[2]) : data.length - 1;
      const chunk = data.subarray(start, end + 1);
      const headers = {
        "Content-Type": mime,
        "Content-Range": `bytes ${start}-${end}/${data.length}`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(chunk.length),
      };
      return new Response(chunk, { status: 206, headers });
    }
  }
  return new Response(data, {
    headers: {
      "Content-Type": mime,
      "Content-Length": String(data.length),
      "Accept-Ranges": "bytes",
    },
  });
});

app.get("/video-thumbnails/:name", async (c) => {
  const name = c.req.param("name");
  const data = await storage.get(`videos/thumbnails/${name}`);
  if (!data) return c.text("Not found", 404);
  const ext = extname(name).toLowerCase();
  const mime = ext === ".jpg" || ext === ".jpeg"
    ? "image/jpeg"
    : ext === ".png"
    ? "image/png"
    : ext === ".webp"
    ? "image/webp"
    : "application/octet-stream";
  return new Response(data, { headers: { "Content-Type": mime } });
});

export default app;
