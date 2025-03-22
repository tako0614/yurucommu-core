import { z } from "zod";
import { Group, Member } from "../../../../../models/groups/groups.ts";
import { handleReCreateGroup } from "../../../../../web/groups/utils.ts";
import { eventManager } from "../../../eventManager.ts";
import { load } from "@std/dotenv";
const env = await load();

eventManager.add(
    "t.group.sync.role.assign",
    z.object({
        groupId: z.string(),
        roleId: z.array(z.string()),
        userId: z.string(),
        beforeEventId: z.string(),
    }),
    async (c, payload) => {
        const domain = c.get("domain");
        const eventId = c.get("eventId");
        const { groupId, roleId, userId } = payload;
        if (groupId.split("@")[1] !== env["domain"]) {
            return c.json({ error: "Invalid groupId" }, 400);
        }
        if (domain !== groupId.split("@")[1]) {
            return c.json({ error: "Invalid groupId" }, 400);
        }
        const group = await Group.findOne({
            groupId: groupId,
        });
        if (!group) {
            return c.json({ error: "Invalid groupId" }, 400);
        }
        const member = await Member.findOne({
            groupId: groupId,
            userId: userId,
        });
        if (!member) {
            return c.json({ error: "Invalid userId" }, 400);
        }
        if (group.beforeEventId !== payload.beforeEventId) {
            await handleReCreateGroup(groupId, eventId);
            return c.json(200);
        }
        await Member.updateOne(
            { groupId: groupId, userId: userId },
            { role: roleId },
        );
        await Group.updateOne({ groupId }, { beforeEventId: eventId });
        return c.json(200);
    },
);
