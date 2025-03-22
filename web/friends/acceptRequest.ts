import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { Hono } from "hono";
import { uuidv7 } from "npm:uuidv7@^1.0.2";
import { MyEnv } from "../../userInfo.ts";
import friends from "../../models/users/friends.ts";
import { fff } from "../../utils/foundationReq.ts";
import Request from "../../models/request.ts";
import { env } from "./common.ts";
import { getActorByHandle } from "../../activityPub/logic.ts";

const app = new Hono<MyEnv>();

app.post(
    "/",
    zValidator(
        "json",
        z.object({
            id: z.string(),
        }),
    ),
    async (c) => {
        const user = c.get("user");
        if (!user) {
            return c.json({ message: "Unauthorized" }, 401);
        }
        const { id } = c.req.valid("json");
        const request = await Request.findOne({
            id: id,
            receiver: user.userName + "@" + env["domain"],
        });
        if (!request) {
            return c.json({ message: "Invalid request" }, 400);
        }
        if (request.type === "friend") {
            if (!request.local) {
                if (
                    await friends.findOne({
                        userName: request.sender,
                        friendName: request.receiver,
                    })
                ) {
                    return c.json({ message: "Already friend" }, 400);
                }
                const res = await fff(
                    JSON.stringify({
                        event: "t.friend.accept",
                        eventId: uuidv7(),
                        payload: {
                            userId: request.receiver,
                            friendId: request.sender,
                        },
                    }),
                    [request.sender.split("@")[1]],
                );
                if (!Array.isArray(res) || res[0].status !== 200) {
                    return c.json({ message: "Invalid request" }, 400);
                }
                const actor = await getActorByHandle(request.sender);
                await friends.create({
                    userName: request.receiver,
                    friendId: request.sender,
                    actor,
                });
                await Request.deleteOne({ id: id });
                return c.json({ message: "Request accepted" });
            } else {
                await friends.create({
                    userName: request.receiver,
                    friendId: request.sender,
                    actor: await getActorByHandle(request.sender),
                });
                await friends.create({
                    userName: request.sender,
                    friendId: request.receiver,
                    actor: await getActorByHandle(request.receiver),
                });
                await Request.deleteOne({ id: id });
                return c.json({ message: "Request accepted" });
            }
        }
    },
);

export default app;
