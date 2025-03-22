import { z } from "zod";
import { Group, Member } from "../../../../models/groups/groups.ts";
import { handleRemoveChannel } from "../../../../web/groups/channel/delete.ts";
import { eventManager } from "../../eventManager.ts";
import { getUserPermission } from "../../../../utils/getUserPermission.ts";
import { load } from "@std/dotenv";
const env = await load();

eventManager.add(
    "t.group.channel.remove",
    z.object({
        groupId: z.string(),
        userId: z.string(),
        channelId: z.string(),
    }),
    async (c, payload) => {
        const domain = c.get("domain");
        const { groupId, userId, channelId } = payload;
        if (userId.split("@")[1] !== domain) {
            return c.json({ error: "Invalid userId" }, 400);
        }
        if (groupId.split("@")[1] !== env["domain"]) {
            return c.json({ error: "Invalid groupId" }, 400);
        }
        const group = await Group.findOne({ groupId });
        if (!group || !group.isOwner) {
            return c.json({ error: "Invalid groupId" }, 400);
        }
        const permission = await getUserPermission(
            userId,
            groupId,
        );
        if (!permission) {
            return c.json({ message: "Unauthorized1" }, 401);
        }
        if (
            !permission.includes(`MANAGE_CHANNEL`) &&
            !permission.includes(`ADMIN`)
        ) {
            return c.json({ message: "Unauthorized permission" }, 401);
        }
        if (
            !await Member.findOne({
                groupId,
                userId: userId,
            })
        ) {
            return c.json({ message: "Unauthorized2" }, 401);
        }
        await handleRemoveChannel({
            groupId,
            channelId,
            beforeEventId: group.beforeEventId!,
        });
        return c.json(200);
    },
);
