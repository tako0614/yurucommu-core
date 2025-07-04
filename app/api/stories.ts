import { Hono } from "hono";
import { cors } from "hono/cors";
import Story from "./models/story.ts";

const app = new Hono();

// CORSミドルウェア
app.use("/api/stories/*", cors({
  origin: "*",
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
}));

// ストーリー一覧取得
app.get("/api/stories", async (c) => {
  try {
    const stories = await Story.find({
      expiresAt: { $gt: new Date() }
    }).sort({ createdAt: -1 });
    return c.json(stories);
  } catch (error) {
    console.error("Error fetching stories:", error);
    return c.json({ error: "Failed to fetch stories" }, 500);
  }
});

// ストーリー作成
app.post("/api/stories", async (c) => {
  try {
    const body = await c.req.json();
    const { author, content, mediaUrl, mediaType, backgroundColor, textColor } = body;

    if (!author || !content) {
      return c.json({ error: "Author and content are required" }, 400);
    }

    // 24時間後に期限切れ
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    const story = new Story({
      author,
      content,
      mediaUrl,
      mediaType,
      backgroundColor: backgroundColor || "#1DA1F2",
      textColor: textColor || "#FFFFFF",
      expiresAt,
      views: 0,
      createdAt: new Date(),
    });

    await story.save();
    return c.json(story, 201);
  } catch (error) {
    console.error("Error creating story:", error);
    return c.json({ error: "Failed to create story" }, 500);
  }
});

// ストーリー閲覧
app.post("/api/stories/:id/view", async (c) => {
  try {
    const id = c.req.param("id");
    const story = await Story.findByIdAndUpdate(
      id,
      { $inc: { views: 1 } },
      { new: true }
    );

    if (!story) {
      return c.json({ error: "Story not found" }, 404);
    }

    return c.json(story);
  } catch (error) {
    console.error("Error viewing story:", error);
    return c.json({ error: "Failed to view story" }, 500);
  }
});

// ストーリー削除
app.delete("/api/stories/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const story = await Story.findByIdAndDelete(id);

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
    const result = await Story.deleteMany({
      expiresAt: { $lt: new Date() }
    });
    
    return c.json({ 
      message: "Cleanup completed", 
      deletedCount: result.deletedCount 
    });
  } catch (error) {
    console.error("Error cleaning up expired stories:", error);
    return c.json({ error: "Failed to cleanup expired stories" }, 500);
  }
});

export default app;
