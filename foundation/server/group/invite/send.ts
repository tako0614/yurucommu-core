import { z } from "zod";
import { Group, Member } from "../../../../models/groups/groups.ts";
import { eventManager } from "../../eventManager.ts";
import { getUserPermission } from "../../../../utils/getUserPermission.ts";
import { load } from "@std/dotenv";
const env = await load();

eventManager.add(
    "t.group.invite.send",
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
        if (!group || !group.isOwner) {
            return c.json({ error: "Invalid groupId" }, 400);
        }
        if (await Member.findOne({ groupId: groupId, userId: inviteUserId })) {
            return c.json({ error: "Already member" }, 400);
        }
        if (group.invites.includes(inviteUserId)) {
            return c.json({ error: "Already invited" }, 400);
        }
        const permissions = await getUserPermission(
            userId,
            groupId,
        );
        console.log(permissions);
        if (
            !permissions ||
            !permissions.includes("INVITE_USER") &&
                !permissions.includes("ADMIN")
        ) {
            return c.json({ message: "Unauthorized permission" }, 401);
        }
        await Group.updateOne({ groupId }, {
            $push: { invites: inviteUserId },
        });
        return c.json(200);
    },
);
