import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import z from "zod";
import { load } from "@std/dotenv";
import Session from "../../../models/users/sessions.ts";
import users from "../../../models/users/users.ts";
import MigrateData from "../../../models/crypto/migrateData.ts";
import { uuidv7 } from "npm:uuidv7@^1.0.2";
import publish from "../../../utils/redisClient.ts";

const env = await load();
const app = new Hono();

app.post(
  "/",
  zValidator(
    "json",
    z.object({
      migrateKey: z.string(),
    }).strict(),
  ),
  zValidator(
    "cookie",
    z.object({
      sessionid: z.string(),
    }),
  ),
  async (c) => {
    const { migrateKey } = c.req.valid("json");
    const sessionid = c.req.valid("cookie").sessionid;
    const session = await Session.findOne({ sessionid });
    if (!session || session.encrypted) {
      return c.json({ status: "error", message: "Invalid session" }, 400);
    }
    const user = await users.findOne({ userName: session.userName });
    if (!user) {
      return c.json({ status: "error", message: "Invalid user" }, 400);
    }
    const migrateid = uuidv7();
    await MigrateData.create({
      userName: user.userName,
      migrateKey,
      migrateid,
      requesterSessionid: session.sessionid,
    });
    publish({
      type: "migrateRequest",
      users: [user.userName + "@" + env["domain"]],
      data: JSON.stringify({
        migrateid,
        requesterSessionid: session.sessionid,
      }),
    });
    return c.json({ migrateid });
  },
);

export default app;
