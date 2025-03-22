import { Group } from "../../../models/groups/groups.ts";
import { MyEnv } from "../../../userInfo.ts";
import { Hono } from "hono";
const app = new Hono<MyEnv>();
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { load } from "@std/dotenv";
import { uuidv7 } from "npm:uuidv7";
import { fff } from "../../../utils/foundationReq.ts";

const env = await load();

export default app;

app.post(
    "/",
    zValidator(
        "json",
        z.object({
            groupId: z.string(),
            userId: z.string(),
        }),
    ),
    async (c) => {
        const user = c.get("user");
        if (!user) {
            return c.json({ message: "Unauthorized" }, 401);
        }
        const { groupId, userId } = c.req.valid("json");
        if (groupId.split("@")[1] === env["domain"]) {
            const group = await Group.findOne({ groupId });
            if (!group) {
                return c.json({ message: "Invalid groupId" }, 400);
            }
            if (group.type !== "private") {
                return c.json({ message: "Invalid group type" }, 400);
            }
            if (!group.requests.includes(userId)) {
                return c.json({ message: "Invalid request" }, 400);
            }
            await Group.updateOne({ groupId }, { $pull: { requests: userId } });
            return c.json({ message: "success" });
        } else {
            const res = await fff(
                JSON.stringify({
                    event: "t.group.join.remove",
                    eventId: uuidv7(),
                    payload: {
                        groupId,
                        userId: user.userName + "@" + env["domain"],
                        requestUserId: userId,
                    },
                }),
                [groupId.split("@")[1]],
            );
            if (Array.isArray(res) ? res[0].status !== 200 : true) {
                return c.json({ message: "Error removing group" }, 500);
            }
            return c.json({ message: "success" });
        }
    },
);
