import { Channels, Group } from "../../../models/groups/groups.ts";
import { Context, Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { load } from "@std/dotenv";
import { uuidv7 } from "npm:uuidv7";
import { fff } from "../../../utils/foundationReq.ts";
import { getUserPermission } from "../../../utils/getUserPermission.ts";
import { MyEnv } from "../../../userInfo.ts";

const env = await load();
const app = new Hono<MyEnv>();

app.post(
    "/",
    zValidator(
        "json",
        z.object({
            groupId: z.string(),
            order: z.array(z.object({
                type: z.string(),
                id: z.string(),
            })),
        }),
    ),
    async (c) => {
        const user = c.get("user");
        if (!user) {
            return c.json({ message: "Unauthorized" }, 401);
        }
        const { groupId, order } = c.req.valid("json");
        if (groupId.split("@")[1] === env["domain"]) {
            return await handleChannelOrder({
                groupId,
                order,
                c,
            });
        } else {
            const res = await fff(
                JSON.stringify({
                    event: "t.group.channel.order",
                    eventId: uuidv7(),
                    payload: {
                        groupId,
                        userId: user.userName + "@" + env["domain"],
                        order,
                    },
                }),
                [groupId.split("@")[1]],
            );
            if (Array.isArray(res) ? res[0].status !== 200 : true) {
                return c.json({ message: "Error setting channel order" }, 500);
            }
            return c.json({ message: "success" });
        }
    },
);

export async function handleChannelOrder({
    groupId,
    order,
    c,
}: {
    groupId: string;
    order: { type: string; id: string }[];
    c: Context;
}) {
    const group = await Group.findOne({ groupId });
    if (!group) {
        return c.json({ message: "Invalid groupId" }, 400);
    }
    const permission = await getUserPermission(
        c.get("user").userName + "@" + env["domain"],
        groupId,
    );
    if (!permission) {
        return c.json({ message: "Unauthorized1" }, 401);
    }
    if (
        !permission.includes(`ADMIN`) && !permission.includes(`MANAGE_CHANNEL`)
    ) {
        return c.json({ message: "Unauthorized permission" }, 401);
    }
    const channels = await Channels.find({ groupId });
    const channelIds = channels.map((channel) => channel.id);
    if (order.length !== channelIds.length) {
        return c.json({ message: "Invalid order" }, 400);
    }
    for (const o of order) {
        if (!channelIds.includes(o.id)) {
            return c.json({ message: "Invalid order" }, 400);
        }
    }
    await Group
        .updateOne({ groupId }, { $set: { channelOrder: order } });
    return c.json({ message: "success" });
}

export default app;
