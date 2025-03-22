import { Group, Member } from "../../../models/groups/groups.ts";
import { MyEnv } from "../../../userInfo.ts";
import { Context, Hono } from "hono";
const app = new Hono<MyEnv>();
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { load } from "@std/dotenv";
import { uuidv7 } from "npm:uuidv7";
import { fff } from "../../../utils/foundationReq.ts";
import { getUserPermission } from "../../../utils/getUserPermission.ts";

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
            return handleAcceptJoinRequest({
                c,
                groupId,
                userId,
                accepter: user.userName + "@" + env["domain"],
            });
        } else {
            const res = await fff(
                JSON.stringify({
                    event: "t.group.join.accept",
                    eventId: uuidv7(),
                    payload: {
                        groupId,
                        userId: user.userName + "@" + env["domain"],
                        targetUserId: userId,
                    },
                }),
                [groupId.split("@")[1]],
            );
            if (Array.isArray(res) ? res[0].status !== 200 : true) {
                return c.json({ message: "Error accepting group" }, 500);
            }
            return c.json({ message: "success" });
        }
    },
);

export async function handleAcceptJoinRequest({
    c,
    groupId,
    userId,
    accepter,
}: {
    c: Context;
    groupId: string;
    userId: string;
    accepter: string;
}) {
    const group = await Group.findOne({ groupId });
    if (!group) {
        return c.json({ message: "Invalid groupId" }, 400);
    }
    if (group.type == "private") {
        return c.json({ message: "Invalid group type" }, 400);
    }
    if (!group.requests.includes(userId)) {
        return c.json({ message: "Invalid request" }, 400);
    }
    if (
        await Member
            .findOne({ groupId, userId: userId })
    ) {
        return c.json({ message: "Already a member" }, 400);
    }
    if (
        !await Member
            .findOne({ groupId, userId: accepter })
    ) {
        return c.json({ message: "you are not a member" }, 400);
    }
    const permission = await getUserPermission(
        accepter,
        groupId,
    );
    if (!permission) {
        return c.json({ message: "Unauthorized1" }, 401);
    }
    if (!permission.includes(`ADMIN`) && !permission.includes(`MANAGE_USER`)) {
        return c.json({ message: "Unauthorized permission" }, 401);
    }
    if (userId.split("@")[1] !== env["domain"]) {
        const eventId = uuidv7();
        const res = await fff(
            JSON.stringify({
                event: "t.friend.group.accept",
                eventId: eventId,
                payload: {
                    groupId,
                    userId: userId,
                },
            }),
            [userId.split("@")[1]],
        );
        if (Array.isArray(res) ? res[0].status !== 200 : true) {
            return c.json({ message: "Error accepting group" }, 500);
        }
    }

    await Group.updateOne({ groupId }, { $pull: { requests: userId } });
    await Member.create({ groupId, userId, role: [] });

    const domains = (await Member
        .find({ groupId }))
        .map((member: { userId: string }) => member.userId.split("@")[1])
        .filter((domain: string) => domain !== env["domain"]);
    const uniqueDomains = Array.from(new Set(domains));
    const eventId = uuidv7();
    await fff(
        JSON.stringify({
            event: "t.group.sync.user.add",
            eventId: eventId,
            payload: {
                groupId,
                userId,
                role: [],
                beforeEventId: group.beforeEventId,
            },
        }),
        uniqueDomains.filter((domain) => domain !== userId.split("@")[1]),
    );
    return c.json({ message: "success" });
}
