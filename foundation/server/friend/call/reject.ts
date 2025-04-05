import { z } from "zod";
import { eventManager } from "../../eventManager.ts";
import callRequest from "../../../../models/call/request.ts";
import publish from "../../../../utils/redisClient.ts";
import { load } from "@std/dotenv";

const env = await load();

eventManager.add(
  "t.friend.call.reject",
  z.object({
    userId: z.string().email(),
    friendId: z.string().email(),
  }),
  async (c, payload) => {
    // Find the call request
    const roomId = payload.userId + "-" + payload.friendId;
    const call = await callRequest.findOne({ roomId: roomId });
    
    if (!call) {
      return c.json({ status: "error", message: "Invalid call" }, 400);
    }
    
    if (call.friendId !== payload.friendId) {
      return c.json({ status: "error", message: "Invalid call participant" }, 400);
    }

    // Delete the call request
    await callRequest.deleteOne({ roomId: roomId });
    
    // Notify the call requester of rejection
    publish({
      type: "callReject",
      users: [call.userId],
      data: JSON.stringify({
        type: "friend",
        userId: call.friendId,
      }),
      subPubType: "client",
    });
    
    return c.json({ status: "ok" });
  }
);