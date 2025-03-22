import { Hono } from "hono";
import { MyEnv } from "../../userInfo.ts";
import Request from "../../models/request.ts";
import { env } from "./common.ts";

const app = new Hono<MyEnv>();

app.get(
    "/",
    async (c) => {
        const user = c.get("user");
        if (!user) {
            return c.json({ message: "Unauthorized" }, 401);
        }
        const limit = c.req.query("limit");
        const befor = c.req.query("befor");
        if (limit && befor) {
            const requests = await Request.find({
                receiver: user.userName + "@" + env["domain"],
                timestamp: { $lt: new Date(befor) },
            }).sort({ timestamp: -1 }).limit(Number(limit));
            return c.json({ requests });
        }
        const requests = await Request.find({
            receiver: user.userName + "@" + env["domain"],
        }).sort({ timestamp: -1 }).limit(limit ? Number(limit) : 10);
        return c.json({ requests });
    },
);

export default app;
