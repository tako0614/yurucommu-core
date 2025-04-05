import { authorizationMiddleware, MyEnv } from "../../userInfo.ts";
import { Hono } from "hono";
import friends from "../../models/users/friends.ts";
import { load } from "@std/dotenv";
import Message from "../../models/message.ts";
const env = await load();
const app = new Hono<MyEnv>();
app.use("*", authorizationMiddleware);

app.get("/:roomId", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ message: "Unauthorized" }, 401);
  }

  const roomId = c.req.param("roomId");
  const match = roomId.match(/^m\{([^}]+)\}@(.+)$/);
  if (!match) {
    return c.json({ error: "Invalid roomId format" }, 400);
  }

  const friendUserName = match[1];
  const domainFromRoom = match[2];
  const limit = Number(c.req.query("limit")) || 50;
  const before = c.req.query("before");

  // フレンド関係の確認
  const friendExists = await friends.findOne({
    userName: `${user.userName}@${env["domain"]}`,
    friendId: `${friendUserName}@${domainFromRoom}`,
  });

  if (!friendExists) {
    return c.json({ message: "Unauthorized" }, 401);
  }

  try {
    let messages;

    if (!before) {
      // before未指定時は最新メッセージを取得
      messages = await getFriendMessages(
        user.userName,
        env["domain"],
        friendUserName,
        domainFromRoom,
        roomId,
        limit,
      );
    } else {
      // 特定の時間より前のメッセージを取得
      const beforeMessageId = await Message.findOne({
        roomId,
        timestamp: { $lt: new Date(before) },
        isLarge: { $in: [false, undefined] }, // isLargeがfalseまたは未設定
      }).sort({ timestamp: -1 });

      if (!beforeMessageId) {
        return c.json({ error: "Invalid before parameter" }, 400);
      }

      messages = await getFriendMessages(
        user.userName,
        env["domain"],
        friendUserName,
        domainFromRoom,
        roomId,
        limit,
        beforeMessageId.timestamp,
      );
    }

    return c.json({ messages });
  } catch (error) {
    console.error("Error TakosFetching messages:", error);
    return c.json({ error: "Failed to retrieve messages" }, 500);
  }
});

/**
 * フレンド間のメッセージを取得する共通関数
 */
async function getFriendMessages(
  userName: string,
  domain: string,
  friendUserName: string,
  friendDomain: string,
  roomId: string,
  limit: number,
  beforeTime?: Date,
) {
  const projection = { messageid: 1, timestamp: 1, userName: 1, _id: 0 };
  const myRoomCondition = {
    roomId,
    userName: `${userName}@${domain}`,
    isLarge: false,
    ...(beforeTime ? { timestamp: { $lt: beforeTime } } : {}),
  };

  const friendRoomCondition = {
    roomId: `m{${userName}}@${domain}`,
    userName: `${friendUserName}@${friendDomain}`,
    isLarge: false,
    ...(beforeTime ? { timestamp: { $lt: beforeTime } } : {}),
  };

  // 自分と相手のメッセージを並行して取得
  const [myMessages, friendMessages] = await Promise.all([
    Message.find(myRoomCondition, projection).limit(limit).sort({
      timestamp: -1,
    }),
    Message.find(friendRoomCondition, projection).limit(limit).sort({
      timestamp: -1,
    }),
  ]);

  // メッセージを結合、ソート、制限
  return myMessages.concat(friendMessages)
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    .slice(0, limit)
    .reverse(); // クライアント側の表示用に古い順に戻す
}

export default app;
