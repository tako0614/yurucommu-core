import { fff } from "../../utils/foundationReq.ts";
import publish from "../../utils/redisClient.ts";
import { Hono } from "hono";
import { load } from "@std/dotenv";
import { authorizationMiddleware, MyEnv } from "../../userInfo.ts";
import { zValidator } from "@hono/zod-validator";
import z from "zod";
import callRequest from "../../models/call/request.ts";
import friends from "../../models/users/friends.ts";
import { uuidv4, uuidv7 } from "npm:uuidv7@^1.0.2";
import { CallToken } from "../../models/call/token.ts";
const env = await load();
const app = new Hono<MyEnv>();
app.use("*", authorizationMiddleware);

app.post(
  "/audio/request",
  async (c) => {
    const user = c.get("user");
    const session = c.get("session");
    if (!user || !session) {
      return c.json({ status: "error", message: "Invalid session" }, 400);
    }
    const { friendId, roomKeyHash } = await c.req.json();
    if (typeof friendId !== "string" || typeof roomKeyHash !== "string") {
      return c.json({ status: "error", message: "Invalid request" }, 400);
    }
    const friendHost = friendId.split("@")[1];
    if (
      await friends.findOne({
        userName: user.userName + "@" + env["domain"],
        friendId: friendId,
      }) === null
    ) {
      return c.json({ status: "error", message: "Invalid friend" }, 400);
    }
    await callRequest.create({
      userId: user.userName + "@" + env["domain"],
      roomId: user.userName + "@" + env["domain"] + "-" + friendId,
      callType: "audio",
      isEncrypt: true,
      friendId: friendId,
      roomKeyHash: roomKeyHash,
      sessionid: session.sessionid,
    });
    
    if (friendHost !== env["domain"]) {
      await fff(
        JSON.stringify({
          event: "t.friend.call.request",
          eventId: uuidv7(),
          payload: {
            roomKeyHash: roomKeyHash,
            isEncrypt: true,
            friendId: friendId,
            userId: user.userName + "@" + env["domain"], 
          },
        }),
        [friendHost],
      );
    } else {
      publish({
        type: "callRequest",
        users: [friendId],
        data: JSON.stringify({
          type: "friend",
          mode: "audio",
          userId: user.userName + "@" + env["domain"],
          roomKeyHash: roomKeyHash,
        }),
        subPubType: "client",
      });
    }
    return c.json({ status: "ok" });
  },
);

app.post(
  "/video/request",
  async (c) => {
    const user = c.get("user");
    const session = c.get("session");
    if (!user || !session) {
      return c.json({ status: "error", message: "Invalid session" }, 400);
    }
    const { friendId, roomKeyHash } = await c.req.json();
    if (typeof friendId !== "string" || typeof roomKeyHash !== "string") {
      return c.json({ status: "error", message: "Invalid request" }, 400);
    }
    const friendHost = friendId.split("@")[1];
    if (
      await friends.findOne({
        userName: user.userName + "@" + env["domain"],
        friendId: friendId,
      }) === null
    ) {
      return c.json({ status: "error", message: "Invalid friend" }, 400);
    }
    await callRequest.create({
      userId: user.userName + "@" + env["domain"],
      roomId: user.userName + "@" + env["domain"] + "-" + friendId,
      callType: "video",
      isEncrypt: true,
      friendId: friendId,
      roomKeyHash: roomKeyHash,
      sessionid: session.sessionid,
    });
    
    if (friendHost !== env["domain"]) {
      await fff(
        JSON.stringify({
          event: "t.friend.call.request",
          eventId: uuidv7(),
          payload: {
            roomKeyHash: roomKeyHash,
            isEncrypt: true,
            friendId: friendId,
            userId: user.userName + "@" + env["domain"],
            callType: "video", 
          },
        }),
        [friendHost],
      );
    } else {
      publish({
        type: "callRequest",
        users: [friendId],
        data: JSON.stringify({
          type: "friend",
          mode: "video",
          userId: user.userName + "@" + env["domain"],
          roomKeyHash: roomKeyHash,
        }),
        subPubType: "client",
      });
    }
    return c.json({ status: "ok" });
  },
);

app.post(
  "/audio/accept",
  zValidator(
    "json",
    z.object({
      friendId: z.string(),
    }).strict(),
  ),
  async (c) => {
    const user = c.get("user");
    const session = c.get("session");
    if (!user || !session) {
      return c.json({ status: "error", message: "Invalid session" }, 400);
    }
    const { friendId } = c.req.valid("json");
    const roomId = friendId + "-" + user.userName + "@" + env["domain"];
    const call = await callRequest.findOne({ roomId: roomId });
    if (call === null) {
      return c.json({ status: "error", message: "Invalid call" }, 400);
    }
    if (call.friendId !== user.userName + "@" + env["domain"]) {
      return c.json({ status: "error", message: "Invalid call" }, 400);
    }
    const friendHost = call.userId.split("@")[1];
    if (friendHost !== env["domain"]) {
      const res = await fff(
        JSON.stringify({
          event: "t.friend.call.accept",
          eventId: uuidv7(),
          payload: {
            friendId: call.friendId,
            userId: call.userId,
            callType: "audio",
          },
        }),
        [friendHost],
      );
      if (Array.isArray(res)) {
        if (res[0].status !== 200) {
          return c.json({ status: "error", message: "Invalid call" }, 400);
        }
        const data = await res[0].json();
        const token = data.token;
        console.log("token", token);
        return c.json({ status: "ok", token: token });
      } else {
        return c.json({ status: "error", message: res.error }, 400);
      }
    }

    const tokenReqester = uuidv7();
    const tokenReceiver = uuidv7();
    await CallToken.create({
      userId: call.userId,
      roomId: roomId,
      token: tokenReqester,
      callType: "audio",
      type: "friend",
    });
    await CallToken.create({
      userId: call.friendId,
      roomId: roomId,
      token: tokenReceiver,
      callType: "audio",
      type: "friend",
    });
    publish({
      type: "callAccept",
      users: [call.userId],
      data: JSON.stringify({
        type: "friend",
        mode: "audio",
        userId: call.friendId,
        token: tokenReceiver,
        sessionid: call.sessionid,
      }),
      subPubType: "client",
    });
    return c.json({ status: "ok", token: tokenReqester });
  },
);

app.post(
  "/video/accept",
  zValidator(
    "json",
    z.object({
      friendId: z.string(),
    }).strict(),
  ),
  async (c) => {
    const user = c.get("user");
    const session = c.get("session");
    if (!user || !session) {
      return c.json({ status: "error", message: "Invalid session" }, 400);
    }
    const { friendId } = c.req.valid("json");
    const roomId = friendId + "-" + user.userName + "@" + env["domain"];
    const call = await callRequest.findOne({ roomId: roomId });
    if (call === null) {
      return c.json({ status: "error", message: "Invalid call" }, 400);
    }
    if (call.friendId !== user.userName + "@" + env["domain"]) {
      return c.json({ status: "error", message: "Invalid call" }, 400);
    }

    const friendHost = call.userId.split("@")[1];
    if (friendHost !== env["domain"]) {
      const res = await fff(
        JSON.stringify({
          event: "t.friend.call.accept",
          eventId: uuidv7(),
          payload: {
            friendId: call.friendId,
            userId: call.userId,
            callType: "video",
          },
        }),
        [friendHost],
      );
      if (Array.isArray(res)) {
        if (res[0].status !== 200) {
          return c.json({ status: "error", message: "Invalid call" }, 400);
        }
        const data = await res[0].json();
        const token = data.token;
        return c.json({ status: "ok", token: token });
      } else {
        return c.json({ status: "error", message: res.error }, 400);
      }
    }
    const tokenReqester = uuidv7();
    const tokenReceiver = uuidv7();
    await CallToken.create({
      userId: call.userId,
      roomId: roomId,
      token: tokenReqester,
      callType: "video",
      type: "friend",
    });
    await CallToken.create({
      userId: call.friendId,
      roomId: roomId,
      token: tokenReceiver,
      callType: "video",
      type: "friend",
    });

    publish({
      type: "callAccept",
      users: [call.userId],
      data: JSON.stringify({
        type: "friend",
        mode: "video",
        userId: call.friendId,
        token: tokenReceiver,
        sessionid: call.sessionid,
      }),
      subPubType: "client",
    });
    return c.json({ status: "ok", token: tokenReqester });
  },
);

app.post(
  "/audio/reject",
  zValidator(
    "json",
    z.object({
      friendId: z.string(),
    }).strict(),
  ),
  async (c) => {
    const user = c.get("user");
    const session = c.get("session");
    if (!user || !session) {
      return c.json({ status: "error", message: "Invalid session" }, 400);
    }
    
    const { friendId } = c.req.valid("json");
    const roomId = friendId + "-" + user.userName + "@" + env["domain"];
    const call = await callRequest.findOne({ roomId: roomId });
    
    if (!call) {
      return c.json({ status: "error", message: "Invalid call" }, 400);
    }
    
    if (call.friendId !== user.userName + "@" + env["domain"]) {
      return c.json({ status: "error", message: "Invalid call" }, 400);
    }
    
    // Delete the call request from the database
    await callRequest.deleteOne({ roomId: roomId });
    
    // For cross-server calls, need to notify the other server about rejection
    const friendHost = call.userId.split("@")[1];
    if (friendHost !== env["domain"]) {
      const res = await fff(
        JSON.stringify({
          event: "t.friend.call.reject",
          eventId: uuidv7(),
          payload: {
            friendId: call.friendId,
            userId: call.userId,
          },
        }),
        [friendHost],
      );
      
      if (Array.isArray(res)) {
        if (res[0].status !== 200) {
          return c.json({ status: "error", message: "Failed to notify caller server" }, 400);
        }
      } else {
        return c.json({ status: "error", message: res.error }, 400);
      }
    } else {
      // For local calls, notify the caller through Redis
      publish({
        type: "callReject",
        users: [call.userId],
        data: JSON.stringify({
          type: "friend",
          userId: call.friendId,
        }),
        subPubType: "client",
      });
    }
    
    return c.json({ status: "ok" });
  }
);

app.post(
  "/video/reject",
  zValidator(
    "json",
    z.object({
      friendId: z.string(),
    }).strict(),
  ),
  async (c) => {
    const user = c.get("user");
    const session = c.get("session");
    if (!user || !session) {
      return c.json({ status: "error", message: "Invalid session" }, 400);
    }
    
    const { friendId } = c.req.valid("json");
    const roomId = friendId + "-" + user.userName + "@" + env["domain"];
    const call = await callRequest.findOne({ roomId: roomId });
    
    if (!call) {
      return c.json({ status: "error", message: "Invalid call" }, 400);
    }
    
    if (call.friendId !== user.userName + "@" + env["domain"]) {
      return c.json({ status: "error", message: "Invalid call" }, 400);
    }
    
    // Delete the call request from the database
    await callRequest.deleteOne({ roomId: roomId });
    
    // For cross-server calls, need to notify the other server about rejection
    const friendHost = call.userId.split("@")[1];
    if (friendHost !== env["domain"]) {
      const res = await fff(
        JSON.stringify({
          event: "t.friend.call.reject",
          eventId: uuidv7(),
          payload: {
            friendId: call.friendId,
            userId: call.userId,
          },
        }),
        [friendHost],
      );
      
      if (Array.isArray(res)) {
        if (res[0].status !== 200) {
          return c.json({ status: "error", message: "Failed to notify caller server" }, 400);
        }
      } else {
        return c.json({ status: "error", message: res.error }, 400);
      }
    } else {
      // For local calls, notify the caller through Redis
      publish({
        type: "callReject",
        users: [call.userId],
        data: JSON.stringify({
          type: "friend",
          userId: call.friendId,
        }),
        subPubType: "client",
      });
    }
    
    return c.json({ status: "ok" });
  }
);

export default app;
