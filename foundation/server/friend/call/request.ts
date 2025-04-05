import { z } from "zod";
import friends from "../../../../models/users/friends.ts";
import { eventManager } from "../../eventManager.ts";
import { load } from "@std/dotenv";
import publish from "../../../../utils/redisClient.ts";
import callRequest from "../../../../models/call/request.ts";

const env = await load();

eventManager.add(
  "t.friend.call.request",
  z.object({
    userId: z.string().email(),
    friendId: z.string().email(),
    roomKeyHash: z.string(),
    isEncrypt: z.boolean().optional().default(true),
    callType: z.enum(["audio", "video"]).optional().default("audio"),
  }),
  async (c, payload) => {
    // Validate the friendship relationship
    const friendship = await friends.findOne({
      userName: payload.friendId,
      friendId: payload.userId,
    });
    
    if (!friendship) {
      return c.json({ status: "error", message: "Invalid friendship" }, 400);
    }
    
    // Create call request in database
    const roomId = payload.userId + "-" + payload.friendId;
    await callRequest.create({
      userId: payload.userId,
      roomId: roomId,
      callType: payload.callType,
      isEncrypt: payload.isEncrypt,
      friendId: payload.friendId,
      roomKeyHash: payload.roomKeyHash,
      sessionid: null, // Federation doesn't have session information
    });
    
    // Notify the user via Redis pub/sub
    publish({
      type: "callRequest",
      users: [payload.friendId],
      data: JSON.stringify({
        type: "friend",
        mode: payload.callType,
        userId: payload.userId,
        roomKeyHash: payload.roomKeyHash,
      }),
      subPubType: "client",
    });
    
    return c.json({ status: "ok" });
  }
);
