import { z } from "zod";
import { Member } from "../../../models/groups/groups.ts";
import Message from "../../../models/message.ts";
import friends from "../../../models/users/friends.ts";
import publish from "../../../utils/redisClient.ts";
import { eventManager } from "../eventManager.ts";

import { load } from "@std/dotenv";
import { getUserPermission } from "../../../utils/getUserPermission.ts";
const env = await load();

eventManager.add(
  "t.message.send",
  z.object({
    userId: z.string().email(),
    messageId: z.string(),
    roomId: z.string(),
    roomType: z.string(),
    channelId: z.string().optional(),
  }),
  async (c, payload) => {
    console.log("t.message.send");
    const domain = c.get("domain");
    const { userId, messageId, roomId, roomType, channelId } = payload;
    if (userId.split("@")[1] !== domain) {
      console.log("error1");
      return c.json({ error: "Invalid userId" }, 400);
    }
    if (roomType !== "friend" && roomType !== "group") {
      console.log("error3");
      return c.json({ error: "Invalid roomType" }, 400);
    }
    console.log(messageId);
    if (roomType === "friend") {
      if (roomId.split("@")[1] !== env["domain"]) {
        return c.json({ error: "Invalid roomId" }, 400);
      }
      const match = roomId.match(/^m\{([^}]+)\}@(.+)$/);
      if (!match) {
        return c.json({ error: "Invalid roomId format" }, 400);
      }
      const roomIdUserName = match[1];
      const roomIdDomain = match[2];
      const friendRecord = await friends.findOne({
        userName: roomIdUserName + "@" + roomIdDomain,
        friendId: userId,
      });
      if (!friendRecord) {
        return c.json({ message: "Unauthorized" }, 401);
      }
      if (messageId.split("@")[1] !== domain) {
        return c.json({ message: "Unauthorized" }, 401);
      }
      const timestamp = new Date();
      await Message.create({
        roomId: roomId,
        messageid: messageId,
        userName: userId,
        timestamp: timestamp,
        isLarge: false,
      });
      publish({
        type: "message",
        users: [roomIdUserName + "@" + roomIdDomain],
        data: JSON.stringify({
          messageid: messageId,
          timestamp,
          userName: userId,
          roomid: `m{${userId.split("@")[0]}}@${userId.split("@")[1]}`,
        }),
      });
      return c.json({ message: "success" });
    }
    if (roomType === "group") {
      const match = roomId.match(/^g\{([^}]+)\}@(.+)$/);
      if (!match) {
        return c.json({ error: "Invalid roomId format" }, 400);
      }
      const roomIdUserName = match[1];
      const roomIdDomain = match[2];
      if (!channelId) {
        return c.json({ error: "Invalid channelId" }, 400);
      }
      const permission = await getUserPermission(
        userId,
        roomIdUserName + "@" + roomIdDomain,
        channelId,
      );
      if (
        !permission.includes("SEND_MESSAGE") && !permission.includes("ADMIN")
      ) {
        return c.json({ message: "Unauthorized" }, 401);
      }
      if (messageId.split("@")[1] !== domain) {
        return c.json({ message: "Unauthorized" }, 401);
      }
      const timestamp = new Date();
      await Message.create({
        roomId: roomId,
        messageid: messageId,
        userName: userId,
        timestamp: timestamp,
        channelId: channelId,
        isLarge: false,
      });
      const members = (
        await Member.find({ groupId: roomIdUserName + "@" + roomIdDomain })
      )
        .map((member) => member.userId)
        .filter((member) => member.split("@")[1] == env["domain"]);
      publish({
        type: "message",
        users: members,
        data: JSON.stringify({
          messageid: messageId,
          timestamp,
          userName: userId,
          roomid: `g{${roomIdUserName}}@${roomIdDomain}`,
          channelId: channelId,
        }),
      });
      return c.json({ message: "success" });
    }
    console.log("error4");
    return c.json({ error: "Invalid roomType" }, 400);
  },
);
