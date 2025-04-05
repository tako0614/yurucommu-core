import { Hono } from "hono";
import { load } from "@std/dotenv";
import { authorizationMiddleware, MyEnv } from "../../userInfo.ts";
import { zValidator } from "@hono/zod-validator";
import z from "zod";
import { fff } from "../../utils/foundationReq.ts";
import callRequest from "../../models/call/request.ts";
import { uuidv7 } from "npm:uuidv7@^1.0.2";

const env = await load();
const app = new Hono<MyEnv>();
app.use("*", authorizationMiddleware);

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
    }
    
    return c.json({ status: "ok" });
  }
);

export default app;