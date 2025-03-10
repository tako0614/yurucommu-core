import { zValidator } from "@hono/zod-validator";
import { authorizationMiddleware, MyEnv } from "../../userInfo.ts";
import { Hono } from "hono";
import { load } from "@std/dotenv";
import Message from "../../models/message.ts";
import { z } from "zod";
const env = await load();
const app = new Hono<MyEnv>();
app.use("*", authorizationMiddleware);

app.post(
  "/",
  zValidator(
    "json",
    z.object({
      messageId: z.string(),
    }),
  ),
  async (c) => {
    const user = c.get("user");
    if (!user) {
      return c.json({ message: "Unauthorized" }, 401);
    }
    const { messageId } = c.req.valid("json");
    const message = await Message.findOne({ messageid: messageId });
    if (!message) {
      return c.json({ message: "Message not found" }, 404);
    }
    if (message.userName !== user.userName + "@" + env["domain"]) {
      return c.json({ message: "Unauthorized" }, 401);
    }
    await Message.deleteOne({ messageid: messageId });
    return c.json({ message: "Deleted" }, 200);
  },
);

export default app;
