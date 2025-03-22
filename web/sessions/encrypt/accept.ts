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
            migrateSignKey: z.string(),
            migrateid: z.string(),
        }).strict(),
    ),
    zValidator(
        "cookie",
        z.object({
            sessionid: z.string(),
        }),
    ),
    async (c) => {
        const { migrateSignKey, migrateid } = c.req.valid("json");
        const sessionid = c.req.valid("cookie").sessionid;
        const session = await Session.findOne({ sessionid });
        if (!session || !session.encrypted) {
            console.log("Invalid session");
            return c.json({ status: "error", message: "Invalid session" }, 400);
        }
        const user = await users.findOne({ userName: session.userName });
        if (!user) {
            return c.json({ status: "error", message: "Invalid user" }, 400);
        }
        const migrateData = await MigrateData.findOne({ migrateid });
        if (!migrateData) {
            return c.json(
                { status: "error", message: "Invalid migrateid" },
                400,
            );
        }
        await MigrateData.updateOne({ migrateid }, {
            migrateSignKey,
            accepterSessionid: session.sessionid,
            accept: true,
        });
        publish({
            type: "migrateAccept",
            users: [user.userName + "@" + env["domain"]],
            data: JSON.stringify({
                migrateid,
                requesterSessionid: migrateData.requesterSessionid,
            }),
            subPubType: "client",
        });
        return c.json({ status: "success" });
    },
);

export default app;
