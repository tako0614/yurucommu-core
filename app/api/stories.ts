import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  deleteManyObjects,
  deleteObject,
  findObjects,
  saveObject,
  updateObject,
} from "./services/unified_store.ts";
import authRequired from "./utils/auth.ts";
import { createObjectId } from "./utils/activitypub.ts";
import { getEnv } from "./utils/env_store.ts";

const app = new Hono();
app.use("*", authRequired);

// CORSミドルウェア
app.use(
  "/api/stories/*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  }),
);

// ストーリー一覧取得
app.get("/api/stories", async (c) => {
  try {
    const stories = await findObjects({
      type: "Story",
      "extra.expiresAt": { $gt: new Date() },
    }, { published: -1 });
    type Story = {
      _id: { toString(): string };
      attributedTo: string;
      content: string;
      published: string | Date;
      extra: {
        mediaUrl?: string;
        mediaType?: string;
        backgroundColor?: string;
        textColor?: string;
        expiresAt?: string | Date;
        views?: number;
      };
    };

    const formatted = stories.map((s) => {
      const story = s as Story;
      return {
        id: story._id.toString(),
        author: story.attributedTo,
        content: story.content,
        mediaUrl: story.extra.mediaUrl,
        mediaType: story.extra.mediaType,
        backgroundColor: story.extra.backgroundColor,
        textColor: story.extra.textColor,
        createdAt: story.published,
        expiresAt: story.extra.expiresAt,
        views: story.extra.views,
      };
    });
    return c.json(formatted);
  } catch (error) {
    console.error("Error fetching stories:", error);
    return c.json({ error: "Failed to fetch stories" }, 500);
  }
});

// ストーリー作成
app.post("/api/stories", async (c) => {
  try {
    const body = await c.req.json();
    const { author, content, mediaUrl, mediaType, backgroundColor, textColor } =
      body;

    if (!author || !content) {
      return c.json({ error: "Author and content are required" }, 400);
    }

    // 24時間後に期限切れ
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    const domain = getEnv()["ACTIVITYPUB_DOMAIN"] ?? "";
    const story = await saveObject(c.get("env") as Record<string, string>, {
      _id: createObjectId(domain),
      type: "Story",
      attributedTo: author,
      content,
      published: new Date(),
      extra: {
        mediaUrl,
        mediaType,
        backgroundColor: backgroundColor || "#1DA1F2",
        textColor: textColor || "#FFFFFF",
        expiresAt,
        views: 0,
      },
      actor_id: `https://${domain}/users/${author}`,
      aud: { to: ["https://www.w3.org/ns/activitystreams#Public"], cc: [] },
    });
    return c.json({
      id: story._id.toString(),
      author: story.attributedTo,
      content: story.content,
      mediaUrl: story.extra.mediaUrl,
      mediaType: story.extra.mediaType,
      backgroundColor: story.extra.backgroundColor,
      textColor: story.extra.textColor,
      createdAt: story.published,
      expiresAt: story.extra.expiresAt,
      views: story.extra.views,
    }, 201);
  } catch (error) {
    console.error("Error creating story:", error);
    return c.json({ error: "Failed to create story" }, 500);
  }
});

// ストーリー閲覧
app.post("/api/stories/:id/view", async (c) => {
  try {
    const id = c.req.param("id");
    const story = await updateObject(id, { $inc: { "extra.views": 1 } });

    if (!story) {
      return c.json({ error: "Story not found" }, 404);
    }

    return c.json({
      id: story._id.toString(),
      author: story.attributedTo,
      content: story.content,
      mediaUrl: story.extra.mediaUrl,
      mediaType: story.extra.mediaType,
      backgroundColor: story.extra.backgroundColor,
      textColor: story.extra.textColor,
      createdAt: story.published,
      expiresAt: story.extra.expiresAt,
      views: story.extra.views,
    });
  } catch (error) {
    console.error("Error viewing story:", error);
    return c.json({ error: "Failed to view story" }, 500);
  }
});

// ストーリー削除
app.delete("/api/stories/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const story = await deleteObject(id);

    if (!story) {
      return c.json({ error: "Story not found" }, 404);
    }

    return c.json({ message: "Story deleted successfully" });
  } catch (error) {
    console.error("Error deleting story:", error);
    return c.json({ error: "Failed to delete story" }, 500);
  }
});

// 期限切れストーリーのクリーンアップ（定期実行用）
app.delete("/api/stories/cleanup", async (c) => {
  try {
    const result = await deleteManyObjects({
      type: "Story",
      "extra.expiresAt": { $lt: new Date() },
    });

    return c.json({
      message: "Cleanup completed",
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    console.error("Error cleaning up expired stories:", error);
    return c.json({ error: "Failed to cleanup expired stories" }, 500);
  }
});

export default app;
