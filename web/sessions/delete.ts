import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import z from "zod";
import Session from "../../models/users/sessions.ts";
import shareAccountKey from "../../models/crypto/shareAccountKey.ts";

const app = new Hono();

app.post(
    "/:uuid",
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
        const sessionUUID = c.req.param("uuid");
        await Session.deleteOne({ userName: session.userName, sessionUUID });
        await shareAccountKey.deleteMany({ sessionid: session.sessionid });
        return c.json({ status: "success" });
    },
);

export default app;
