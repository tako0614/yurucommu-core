import { z } from "zod";
import { eventManager } from "../../eventManager.ts";
import callRequest from "../../../../models/call/request.ts";
import { CallToken } from "../../../../models/call/token.ts";
import publish from "../../../../utils/redisClient.ts";
import { load } from "@std/dotenv";
import { uuidv7 } from "npm:uuidv7@^1.0.2";

const env = await load();

eventManager.add(
  "t.friend.call.accept",
  z.object({
    userId: z.string().email(),
    friendId: z.string().email(),
    callType: z.enum(["audio", "video"]).optional().default("audio"),
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

    // Generate tokens for both participants
    const tokenRequester = uuidv7();
    const tokenReceiver = uuidv7();
    
    // Store tokens in database
    await CallToken.create({
      userId: call.userId,
      roomId: roomId,
      token: tokenRequester,
      callType: payload.callType,
      type: "friend",
    });
    
    await CallToken.create({
      userId: call.friendId,
      roomId: roomId,
      token: tokenReceiver,
      callType: payload.callType,
      type: "friend",
    });
    // Notify the call requester of acceptance
    publish({
      type: "callAccept",
      users: [call.userId],
      data: JSON.stringify({
        type: "friend",
        mode: payload.callType,
        userId: call.friendId,
        token: tokenReceiver,
        sessionid: call.sessionid,
      }),
      subPubType: "client",
    });
    
    // Return the token to the foundation event
    return c.json({ 
      status: "ok", 
      token: tokenRequester 
    });
  }
);