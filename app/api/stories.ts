import { Hono } from "hono";
import { cors } from "hono/cors";
import ActivityPubObject from "./models/activitypub_object.ts";
import authRequired from "./utils/auth.ts";

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
    const stories = await ActivityPubObject.find({
      type: "Story",
      "extra.expiresAt": { $gt: new Date() },
    }).sort({ published: -1 }).lean();
    const formatted = stories.map((s: Record<string, unknown>) => ({
      id: s._id.toString(),
      author: s.attributedTo,
      content: s.content,
      mediaUrl: s.extra.mediaUrl,
      mediaType: s.extra.mediaType,
      backgroundColor: s.extra.backgroundColor,
      textColor: s.extra.textColor,
      createdAt: s.published,
      expiresAt: s.extra.expiresAt,
      views: s.extra.views,
    }));
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

    const story = new ActivityPubObject({
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
    });

    await story.save();
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
    const story = await ActivityPubObject.findByIdAndUpdate(
      id,
      { $inc: { "extra.views": 1 } },
      { new: true },
    ).lean();

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
    const story = await ActivityPubObject.findByIdAndDelete(id);

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
    const result = await ActivityPubObject.deleteMany({
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
