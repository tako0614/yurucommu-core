import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import z from "zod";
import { load } from "@std/dotenv";
import Session from "../../../models/users/sessions.ts";
import users from "../../../models/users/users.ts";
import MigrateData from "../../../models/crypto/migrateData.ts";
import publish from "../../../utils/redisClient.ts";

const env = await load();
const app = new Hono();

app.post(
  "/",
  zValidator(
    "json",
    z.object({
      migrateid: z.string(),
      sign: z.string(),
      data: z.string(),
    }).strict(),
  ),
  zValidator(
    "cookie",
    z.object({
      sessionid: z.string(),
    }),
  ),
  async (c) => {
    const { migrateid, sign, data } = c.req.valid("json");
    const sessionid = c.req.valid("cookie").sessionid;
    const session = await Session.findOne({ sessionid });
    if (!session || !session.encrypted) {
      return c.json({ status: "error", message: "Invalid session" }, 400);
    }
    const user = await users.findOne({ userName: session.userName });
    if (!user) {
      return c.json({ status: "error", message: "Invalid user" }, 400);
    }
    const migrateData = await MigrateData.findOne({ migrateid });
    if (!migrateData) {
      return c.json({ status: "error", message: "Invalid migrateid" }, 400);
    }
    if (!migrateData.accept) {
      return c.json(
        { status: "error", message: "The request is not accepted" },
        400,
      );
    }
    if (migrateData.accepterSessionid !== session.sessionid) {
      return c.json({ status: "error", message: "Invalid session" }, 400);
    }
    await MigrateData.updateOne({ migrateid }, {
      migrateData: data,
      sign,
      sended: true,
    });
    publish({
      type: "migrateData",
      users: [user.userName + "@" + env["domain"]],
      data: JSON.stringify({
        migrateid,
        requesterSessionid: migrateData.requesterSessionid,
      }),
    });
    return c.json({ status: "success" });
  },
);

export default app;
