import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { Hono } from "hono";
import { uuidv7 } from "npm:uuidv7@^1.0.2";
import { MyEnv } from "../../userInfo.ts";
import friends from "../../models/users/friends.ts";
import { fff } from "../../utils/foundationReq.ts";
import Request from "../../models/request.ts";
import { env } from "./common.ts";

const app = new Hono<MyEnv>();

app.post(
    "/",
    zValidator(
        "json",
        z.object({
            userName: z.string(),
        }),
    ),
    async (c) => {
        const user = c.get("user");
        if (!user) {
            return c.json({ message: "Unauthorized" }, 401);
        }
        const { userName } = c.req.valid("json");
        const name = userName.split("@")[0];
        const domain = userName.split("@")[1];
        if (!name || !domain) {
            return c.json({ message: "Invalid userName1" }, 400);
        }
        if (name === user.userName && domain === env["domain"]) {
            return c.json({ message: "Invalid userName2" }, 400);
        }
        const isFriend = await friends.findOne({
            userName: user.userName + "@" + env["domain"],
            friendId: userName,
        });
        if (isFriend) return c.json({ message: "Already friend" }, 400);
        if (domain !== env["domain"]) {
            const result = await fff(
                JSON.stringify({
                    event: "t.friend.request",
                    eventId: uuidv7(),
                    payload: {
                        userId: user.userName + "@" + env["domain"],
                        friendId: userName,
                    },
                }),
                [domain],
            );
            if (!Array.isArray(result) || result[0].status !== 200) {
                return c.json({ message: "Invalid userName3" }, 400);
            }
            const res = await result[0].json();
            if (res.error) {
                return c.json({ message: "Invalid userName4" }, 400);
            }
            await Request.create({
                type: "friend",
                sender: user.userName + "@" + env["domain"],
                receiver: userName,
                local: false,
            });
            return c.json({ message: "Request sent" });
        }
        if (domain === env["domain"]) {
            await Request.create({
                type: "friend",
                sender: user.userName + "@" + env["domain"],
                receiver: userName,
                local: true,
            });
            return c.json({ message: "Request sent" });
        }
    },
);

export default app;
