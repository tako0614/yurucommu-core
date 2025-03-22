import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import z from "zod";
import users from "../../models/users/users.ts";
import { verifyPassword } from "../../utils/password.ts";
import { generateDeviceKey } from "@takos/takos-encrypt-ink";
import Session from "../../models/users/sessions.ts";
import { setCookie } from "hono/cookie";
import { generateSessionId } from "./utils.ts";

const app = new Hono();

app.post(
    "/",
    zValidator(
        "json",
        z.object({
            userName: z.string().min(3).max(20).regex(/^[a-zA-Z0-9_]+$/),
            password: z.string(),
            sessionUUID: z.string().regex(
                /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
                "Invalid UUID",
            ),
        }).strict(),
    ),
    async (c) => {
        const { userName, password, sessionUUID } = c.req.valid("json");
        const user = await users.findOne({ userName });
        if (!user) {
            return c.json({
                status: "error",
                message: "Invalid username or password",
            }, 400);
        }
        if (!await verifyPassword(password, user.password, user.salt)) {
            return c.json({
                status: "error",
                message: "Invalid username or password",
            }, 400);
        }
        const sessionid = generateSessionId();
        const deviceKey = await generateDeviceKey();
        await Session.create({
            userName: user.userName,
            sessionid: sessionid,
            deviceKey: deviceKey,
            sessionUUID: sessionUUID,
            userAgent: c.req.header("User-Agent"),
        });
        setCookie(c, "sessionid", sessionid, {
            httpOnly: true,
            sameSite: "Lax",
            maxAge: 34560000,
        });
        return c.json({ sessionid: sessionid });
    },
);

export default app;
