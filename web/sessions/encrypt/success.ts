import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import z from "zod";
import Session from "../../../models/users/sessions.ts";
import users from "../../../models/users/users.ts";
import { verifyMasterKey } from "@takos/takos-encrypt-ink";

const app = new Hono();

app.post(
  "/",
  zValidator(
    "cookie",
    z.object({
      sessionid: z.string(),
    }),
  ),
  zValidator(
    "json",
    z.object({
      shareKey: z.string(),
      shareKeySign: z.string(),
    }),
  ),
  async (c) => {
    const { shareKey, shareKeySign } = c.req.valid("json");
    const sessionid = c.req.valid("cookie").sessionid;
    const session = await Session.findOne({ sessionid });
    if (!session || session.encrypted) {
      return c.json({ status: "error", message: "Invalid session" }, 400);
    }
    const user = await users.findOne({ userName: session.userName });
    if (!user || !user.masterKey) {
      return c.json({ status: "error", message: "Invalid user" }, 400);
    }
    if (!verifyMasterKey(user.masterKey, shareKeySign, shareKey)) {
      return c.json(
        { status: "error", message: "Invalid shareKey" },
        400,
      );
    }
    await Session.updateOne({ sessionid }, {
      encrypted: true,
      shareKey,
      shareKeySign,
    });
    return c.json({ status: "success" });
  },
);

export default app;
