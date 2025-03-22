import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import z from "zod";
import Session from "../../models/users/sessions.ts";

const app = new Hono();

app.get(
    "/",
    zValidator(
        "cookie",
        z.object({
            sessionid: z.string(),
        }),
    ),
    async (c) => {
        const sessionid = c.req.valid("cookie").sessionid;
        const session = await Session.findOne({ sessionid });
        if (!session) {
            return c.json({ status: "error", message: "Invalid session" }, 400);
        }
        const sessions = await Session.find({ userName: session.userName });
        const result = [];
        for (const s of sessions) {
            result.push({
                uuid: s.sessionUUID,
                encrypted: s.encrypted,
                userAgent: s.userAgent,
                shareKey: s.shareKey,
                shareKeySign: s.shareKeySign,
            });
        }
        return c.json(result);
    },
);

export default app;
