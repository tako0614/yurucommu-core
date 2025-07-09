import { Hono } from "hono";
import { upgradeWebSocket } from 'hono/deno'
import { ensureDir } from "@std/fs";
import { extname, join } from "@std/path";
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

const UPLOAD_DIR = "uploads/videos";

// --- Helper Functions ---
async function deliverVideoToFollowers(
  video: InstanceType<typeof ActivityPubObject> & { toObject: () => Record<string, unknown> },
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

const videoUploadWs = upgradeWebSocket((c) => {
  let filePath: string | undefined;
  let fileHandle: Deno.FsFile | undefined;
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
    async onOpen(evt, ws) {
      console.log("WebSocket connection opened");
      ws.send(JSON.stringify({ status: "ready for metadata" }));
    },
    async onMessage(evt, ws) {
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
            const filename = `${crypto.randomUUID()}${ext}`;
            filePath = join(UPLOAD_DIR, filename);

            await ensureDir(UPLOAD_DIR);
            fileHandle = await Deno.open(filePath, {
              write: true,
              create: true,
            });

            ws.send(JSON.stringify({ status: "ready for binary" }));
            return;
          }
        } catch (e) {
          ws.close(1003, "Invalid metadata format");
          return;
        }
      }

      // Subsequent messages are binary data
      if (evt.data instanceof ArrayBuffer) {
        if (fileHandle) {
          try {
            await fileHandle.write(new Uint8Array(evt.data));
          } catch (err) {
            console.error("Failed to write chunk:", err);
            ws.close(1011, "Server error during write");
          }
        } else {
          ws.close(1003, "Not ready for binary data");
        }
      }
    },
    async onClose(evt, ws) {
      console.log("WebSocket connection closed");
      if (fileHandle) {
        fileHandle.close();
      }

      if (filePath && videoMetadata) {
        console.log(`File saved to: ${filePath}`);

        const domain = getDomain(c);
        const videoUrl = `/api/video-files/${filePath.split("/").pop()}`;

        const video = new ActivityPubObject({
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
        });

        await video.save();
        deliverVideoToFollowers(video, videoMetadata.author, domain);
        console.log("Video metadata saved to database.");
      } else {
        console.log("Upload incomplete, cleaning up.");
        if (filePath) {
          await Deno.remove(filePath).catch(console.error);
        }
      }
    },
    onError(evt, ws) {
      console.error("WebSocket error:", evt);
      if (fileHandle) {
        fileHandle.close();
      }
      if (filePath) {
        Deno.remove(filePath).catch(console.error);
      }
    },
  };
});

app.get("/videos/upload", videoUploadWs);

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

  await ensureDir(UPLOAD_DIR);
  const ext = extname(file.name) || ".mp4";
  const filename = `${crypto.randomUUID()}${ext}`;
  const filePath = join(UPLOAD_DIR, filename);
  const bytes = new Uint8Array(await file.arrayBuffer());
  await Deno.writeFile(filePath, bytes);

  const videoUrl = `/api/video-files/${filename}`;

  const video = new ActivityPubObject({
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
    description,
    hashtags: hashtagsStr ? hashtagsStr.split(" ") : [],
    videoUrl,
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

app.get("/video-files/:name", async (c) => {
  const name = c.req.param("name");
  const path = join(UPLOAD_DIR, name);
  try {
    const file = await Deno.open(path, { read: true });
    const ext = extname(name).toLowerCase();
    const mime = ext === ".mp4"
      ? "video/mp4"
      : ext === ".webm"
      ? "video/webm"
      : "application/octet-stream";
    return new Response(file.readable, { headers: { "Content-Type": mime } });
  } catch {
    return c.text("Not found", 404);
  }
});

export default app;
