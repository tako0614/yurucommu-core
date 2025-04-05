import { authorizationMiddleware, MyEnv } from "../../userInfo.ts";
import { Hono } from "hono";
import { load } from "@std/dotenv";
import Message from "../../models/message.ts";
import { Member } from "../../models/groups/groups.ts";
const env = await load();
const app = new Hono<MyEnv>();
app.use("*", authorizationMiddleware);

app.get("/:roomId/:channelId", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ message: "Unauthorized" }, 401);
  }
  const roomId = c.req.param("roomId");
  const channelId = c.req.param("channelId");
  const limit = Number(c.req.query("limit")) || 50;
  const bfore = c.req.query("before");
  if (
    !Member.findOne({
      groupId: roomId,
      userId: user.userName + "@" + env["domain"],
    })
  ) {
    return c.json({ message: "Unauthorized" }, 401);
  }
  if (!bfore) {
    const messages = await Message.find({
      roomId,
      channelId,
      isLarge: false,
    }, { messageid: 1, timestamp: 1, userName: 1, _id: 0 }).limit(limit)
      .sort({
        timestamp: -1,
      });
    return c.json({ messages });
  }
  const beforeMessageId = await Message.findOne({
    roomId,
    channelId,
    timestamp: { $lt: new Date(bfore) },
    isLarge: false,
  }).sort({ timestamp: -1 });
  if (!beforeMessageId) {
    return c.json({ error: "Invalid before" }, 400);
  }
  const beforemessageTime = beforeMessageId.timestamp;
  const messages = await Message.find({
    roomId,
    channelId,
    isLarge: false,
    timestamp: { $lt: beforemessageTime },
  }, { messageid: 1, timestamp: 1, userName: 1, _id: 0 }).limit(limit).sort({
    timestamp: -1,
  });

  return c.json({ messages });
});

export default app;
