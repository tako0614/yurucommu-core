import { zValidator } from "@hono/zod-validator";
import { authorizationMiddleware, MyEnv } from "../../userInfo.ts";
import { Hono } from "hono";
import { z } from "zod";
import friends from "../../models/users/friends.ts";
import { load } from "@std/dotenv";
import { isValidMessage } from "@takos/takos-encrypt-ink";
import Message from "../../models/message.ts";
import { uuidv7 } from "npm:uuidv7@^1.0.2";
import { fff } from "../../utils/foundationReq.ts";
import publish from "../../utils/redisClient.ts";
import { Channels, Member } from "../../models/groups/groups.ts";
import { getUserPermission } from "../../utils/getUserPermission.ts";
import { uploadFile } from "../../utils/S3Client.ts";
const env = await load();
const app = new Hono<MyEnv>();
app.use("*", authorizationMiddleware);

app.post(
  "/",
  zValidator(
    "json",
    z.object({
      roomId: z.string(),
      message: z.string(),
      sign: z.string(),
      type: z.string(),
      channelId: z.string().optional(),
    }),
  ),
  async (c) => {
    const user = c.get("user");
    if (!user) {
      return c.json({ message: "Unauthorized" }, 401);
    }
    const { roomId, message, sign, type, channelId } = c.req.valid("json");
    const presedMessage = JSON.parse(message);
    const isLarge = presedMessage.isLarge;
    if (type === "friend") {
      if (
        !friends.findOne({
          userName: user.userName + "@" + env["domain"],
          friendId: roomId,
        })
      ) {
        return c.json({ message: "Unauthorized" }, 401);
      }
      if (!isValidMessage(message)) {
        return c.json({ message: "Invalid message" }, 400);
      }
      const messageid = uuidv7() + "@" + env["domain"];
      const timestamp = new Date();
      if (isLarge) {
        await Message.create({
          userName: user.userName + "@" + env["domain"],
          timestamp,
          roomId,
          messageid,
          isEncrypted: true,
          isSigned: true,
          sign,
          isLarge: true,
        });
        await uploadFile(messageid, message);
      } else {
        await Message.create({
          userName: user.userName + "@" + env["domain"],
          timestamp,
          roomId,
          messageid,
          isEncrypted: true,
          isSigned: true,
          message,
          sign,
          isLarge: false,
        });
      }
      if (!isLarge) {
        publish({
          type: "message",
          users: [user.userName + "@" + env["domain"], roomId],
          data: JSON.stringify({
            messageid,
            timestamp,
            userName: user.userName + "@" + env["domain"],
            roomid: roomId,
          }),
        });
        if (roomId.split("@")[1] !== env["domain"]) {
          const res = await fff(
            JSON.stringify({
              event: "t.message.send",
              eventId: uuidv7(),
              payload: {
                userId: user.userName + "@" + env["domain"],
                messageId: messageid,
                roomId: roomId,
                roomType: "friend",
              },
            }),
            [roomId.split("@")[1]],
          ) as [Response] | { error: string };
          if ("error" in res) {
            return c.json({ message: res.error }, 500);
          }
          if (res[0].status !== 200) {
            return c.json({ message: "Failed to send message" }, 500);
          }
        }
      }
      return c.json({ messageId: messageid }, 200);
    }
    if (type === "group") {
      const match = roomId.match(/^g\{([^}]+)\}@(.+)$/);
      if (!match) {
        return c.json({ error: "Invalid roomId format" }, 400);
      }
      const friendUserName = match[1];
      const domainFromRoom = match[2];
      if (!channelId) return;
      console.log(channelId);
      if (
        !await Member.findOne({
          groupId: friendUserName + "@" + domainFromRoom,
          userId: user.userName + "@" + env["domain"],
        })
      ) {
        return c.json({ message: "Unauthorized2" }, 401);
      }
      if (!isValidMessage(message)) {
        return c.json({ message: "Invalid message" }, 400);
      }
      if (!isValidMessage(message)) {
        return c.json({ message: "Invalid message" }, 400);
      }

      if (!await Channels.findOne({ id: channelId })) {
        return c.json({ message: "Unauthorized" }, 401);
      }
      const permission = await getUserPermission(
        user.userName + "@" + env["domain"],
        friendUserName + "@" + domainFromRoom,
        channelId,
      );
      if (
        !permission.includes("SEND_MESSAGE") && !permission.includes("ADMIN")
      ) {
        return c.json({ message: "Unauthorized" }, 401);
      }
      const messageid = uuidv7() + "@" + env["domain"];
      const timestamp = new Date();
      if (isLarge) {
        await Message.create({
          userName: user.userName + "@" + env["domain"],
          timestamp,
          roomId,
          messageid,
          isEncrypted: true,
          isSigned: true,
          sign,
          channelId: channelId,
          isLarge: true,
        });
        await uploadFile(messageid, message);
      } else {
        await Message.create({
          userName: user.userName + "@" + env["domain"],
          timestamp,
          roomId,
          messageid,
          isEncrypted: true,
          isSigned: true,
          message,
          sign,
          channelId: channelId,
          isLarge: false,
        });
      }
      const Members =
        (await Member.find({ groupId: friendUserName + "@" + domainFromRoom }))
          .map((member) => member.userId);
      const MembersDomain = Members.map((member) => member.split("@")[1]);
      const MembersSet = new Set(MembersDomain);
      const MembersArray = Array.from(MembersSet);
      const findMember = MembersArray.findIndex((member) =>
        member === env["domain"]
      );
      if (findMember !== -1) {
        MembersArray.splice(findMember, 1);
      }
      const members = Members.filter((member) =>
        member.split("@")[1] == env["domain"]
      );
      console.log(members);
      publish({
        type: "message",
        users: members,
        data: JSON.stringify({
          messageid,
          timestamp,
          userName: user.userName + "@" + env["domain"],
          roomid: roomId,
          channelId: channelId,
        }),
      });
      if (!isLarge) {
        await fff(
          JSON.stringify({
            event: "t.message.send",
            eventId: uuidv7(),
            payload: {
              userId: user.userName + "@" + env["domain"],
              messageId: messageid,
              roomId: roomId,
              roomType: "group",
              channelId: channelId,
            },
          }),
          MembersArray,
        );
      }
      return c.json({ messageId: messageid }, 200);
    }
  },
);

export default app;
