import { z } from "zod";
import { Group, Member } from "../../../../models/groups/groups.ts";
import { eventManager } from "../../eventManager.ts";
import { load } from "@std/dotenv";
const env = await load();

eventManager.add(
    "t.group.invite.cancel",
    z.object({
        userId: z.string().email(),
        groupId: z.string(),
        inviteUserId: z.string().email(),
    }),
    async (c, payload) => {
        const domain = c.get("domain");
        const { userId, groupId, inviteUserId } = payload;
        if (userId.split("@")[1] !== domain) {
            return c.json({ error: "Invalid userId" }, 400);
        }
        if (groupId.split("@")[1] !== env["domain"]) {
            return c.json({ error: "Invalid groupId" }, 400);
        }
        const group = await Group.findOne({ groupId });
        if (!group || group.owner !== userId) {
            return c.json({ error: "Invalid groupId" }, 400);
        }
        if (await Member.findOne({ groupId: groupId, userId: inviteUserId })) {
            return c.json({ error: "Already member" }, 400);
        }
        if (!group.invites.includes(inviteUserId)) {
            return c.json({ error: "Not invited" }, 400);
        }
        await Group.updateOne({ groupId }, {
            $pull: { invites: inviteUserId },
        });
        return c.json(200);
    },
);
