import { Group, Member } from "../../models/groups/groups.ts";
import { MyEnv } from "../../userInfo.ts";
import { Hono } from "hono";
const app = new Hono<MyEnv>();
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { load } from "@std/dotenv";
import { uuidv7 } from "npm:uuidv7@^1.0.2";
import { fff } from "../../utils/foundationReq.ts";

const env = await load();

export default app;

app.post(
    "/",
    zValidator(
        "json",
        z.object({
            groupId: z.string(),
        }),
    ),
    async (c) => {
        const user = c.get("user");
        if (!user) {
            return c.json({ message: "Unauthorized" }, 401);
        }
        const { groupId } = c.req.valid("json");
        const group = await Group.findOne({ groupId });
        if (!group) {
            return c.json({ message: "Invalid groupId" }, 400);
        }
        const domains = (await Member.find({ groupId })).map((member) =>
            member.userId.split("@")[1]
        ).filter((domain) => domain !== env["domain"]);
        const uniqueDomains = Array.from(new Set(domains));
        if (!group.isOwner) {
            const res = await fff(
                JSON.stringify({
                    event: "t.group.leave",
                    eventId: uuidv7(),
                    payload: {
                        groupId,
                        userId: user.userName + "@" + env["domain"],
                    },
                }),
                [group.groupId.split("@")[1]],
            );
            if (!(Array.isArray(res) && res[0].status === 200)) {
                return c.json({ message: "Error leaving group" }, 500);
            }
            await Member.deleteOne({
                groupId,
                userId: user.userName + "@" + env["domain"],
            });
            return c.json({ message: "success" });
        }
        if (group.owner === user.userName + "@" + env["domain"]) {
            return c.json({ message: "You can't leave the group" }, 400);
        }
        await Member.deleteOne({
            groupId,
            userId: user.userName + "@" + env["domain"],
        });
        const eventId = uuidv7();
        await fff(
            JSON.stringify({
                event: "t.group.sync.user.remove",
                eventId: eventId,
                payload: {
                    groupId,
                    userId: user.userName + "@" + env["domain"],
                    beforeEventId: group.beforeEventId,
                },
            }),
            uniqueDomains,
        );
        await Group.updateOne({ groupId }, {
            $set: { beforeEventId: eventId },
        });
        return c.json({ message: "success" });
    },
);
