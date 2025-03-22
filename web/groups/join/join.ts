import { Group, Member } from "../../../models/groups/groups.ts";
import { MyEnv } from "../../../userInfo.ts";
import { Context, Hono } from "hono";
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
        }),
    ),
    async (c) => {
        const user = c.get("user");
        if (!user) {
            return c.json({ message: "Unauthorized" }, 401);
        }
        const { groupId } = c.req.valid("json");
        if (groupId.split("@")[1] === env["domain"]) {
            return await handleJoinGroup({
                c,
                groupId,
                userId: user.userName + "@" + env["domain"],
            });
        } else {
            const res = await fff(
                JSON.stringify({
                    event: "t.group.join",
                    eventId: uuidv7(),
                    payload: {
                        groupId,
                        userId: user.userName + "@" + env["domain"],
                    },
                }),
                [groupId.split("@")[1]],
            );
            if (Array.isArray(res) ? res[0].status !== 200 : true) {
                return c.json({ message: "Error joining group" }, 500);
            }
            return c.json({ message: "success" });
        }
    },
);

export async function handleJoinGroup({
    c,
    groupId,
    userId,
}: {
    c: Context;
    groupId: string;
    userId: string;
}) {
    const group = await Group.findOne({ groupId });
    if (!group) {
        return c.json({ message: "Invalid groupId" }, 400);
    }
    if (group.type == "private") {
        return c.json({ message: "Invalid group type" }, 400);
    }
    if (group.allowJoin == false) {
        return c.json({ message: "Not allowed to join" }, 400);
    }
    if (
        await Member.findOne({
            groupId,
            userId: userId,
        })
    ) {
        return c.json({ message: "Already a member" }, 400);
    }
    await Member.create({
        groupId,
        userId: userId,
        role: [],
    });
    const domains = (await Member
        .find({ groupId }))
        .map((member: { userId: string }) => member.userId.split("@")[1])
        .filter((domain: string) => domain !== env["domain"])
        .filter((domain: string) => domain !== userId.split("@")[1]);
    const uniqueDomains = Array.from(new Set(domains));
    const eventId = uuidv7();
    await fff(
        JSON.stringify({
            event: "t.group.sync.user.add",
            eventId: eventId,
            payload: {
                groupId,
                userId: userId,
                role: [],
                beforeEventId: group.beforeEventId,
            },
        }),
        uniqueDomains,
    );
    return c.json({ message: "success" });
}
