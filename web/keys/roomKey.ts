import { Hono } from "hono";
import { MyEnv } from "../../userInfo.ts";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { load } from "@std/dotenv";
import friends from "../../models/users/friends.ts";
import { Member } from "../../models/groups/groups.ts";
import RoomKey from "../../models/crypto/roomKey.ts";

const env = await load();
const app = new Hono<MyEnv>();

app.post(
  "/",
  zValidator(
    "json",
    z.object({
      roomId: z.string(),
      encryptedRoomKeys: z.array(z.tuple([z.string(), z.string()])),
      hash: z.string(),
      metaData: z.string(),
      sign: z.string(),
      type: z.string(),
    }),
  ),
  async (c) => {
    const user = c.get("user");
    if (!user) {
      return c.json({ message: "Unauthorized" }, 401);
    }
    const session = c.get("session");
    if (!session) {
      return c.json({ message: "Unauthorized" }, 401);
    }
    const { roomId, encryptedRoomKeys, hash, metaData, sign, type } = c.req
      .valid("json");
    if (type === "friend") {
      if (await RoomKey.findOne({ hash })) {
        return c.json({ message: "Already exists" }, 400);
      }
      const match = roomId.match(/^m\{([^}]+)\}@(.+)$/);
      if (!match) {
        return c.json({ error: "Invalid roomId format" }, 400);
      }
      const friendUserName = match[1];
      const domainFromRoom = match[2];
      if (
        !await friends.findOne({
          userName: user.userName + "@" + env["domain"],
          friendId: friendUserName + "@" + domainFromRoom,
        })
      ) {
        return c.json({ message: "Unauthorized" }, 401);
      }
      if (encryptedRoomKeys.length !== 2) {
        return c.json({ message: "Invalid room key" }, 400);
      }
      await RoomKey.create({
        userName: user.userName,
        roomId,
        hash,
        encrtypedRoomKey: encryptedRoomKeys,
        metaData,
        sign,
      });
    }
    if (type === "group") {
      const match = roomId.match(/^g\{([^}]+)\}@(.+)$/);
      if (!match) {
        return c.json({ error: "Invalid roomId format" }, 400);
      }
      const friendUserName = match[1];
      const domainFromRoom = match[2];
      if (await RoomKey.findOne({ hash })) {
        return c.json({ message: "Already exists" }, 400);
      }
      if (
        !await Member.findOne({
          groupId: friendUserName + "@" + domainFromRoom,
          userId: user.userName + "@" + env["domain"],
        })
      ) {
        return c.json({ message: "Unauthorized" }, 401);
      }
      await RoomKey.create({
        userName: user.userName,
        roomId,
        hash,
        encrtypedRoomKey: encryptedRoomKeys,
        metaData,
        sign,
      });
      return c.json({ message: "success" });
    }
    return c.json({ message: "success" });
  },
);

export default app;
