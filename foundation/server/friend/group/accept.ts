import { z } from "zod";
import {
    Group,
    JoinRequest,
    Member,
} from "../../../../models/groups/groups.ts";
import { createRemoteGroup } from "../../../../web/groups/utils.ts";
import { eventManager } from "../../eventManager.ts";
import { load } from "@std/dotenv";
const env = await load();

eventManager.add(
    "t.friend.group.accept",
    z.object({
        userId: z.string().email(),
        groupId: z.string(),
    }),
    async (c, payload) => {
        const domain = c.get("domain");
        const { userId, groupId } = payload;
        if (userId.split("@")[1] !== env["domain"]) {
            return c.json({ error: "Invalid userId" }, 400);
        }
        if (groupId.split("@")[1] !== domain) {
            return c.json({ error: "Invalid groupId" }, 400);
        }
        const requests = await JoinRequest.findOne({
            groupId: groupId,
            userId: userId,
        });
        if (!requests) {
            return c.json({ error: "Invalid request" }, 400);
        }
        if (!await Group.findOne({ groupId: groupId })) {
            const groupData = await fetch(
                `https://${domain}/_takos/v1/group/all/${groupId}`,
            );
            if (groupData.status !== 200) {
                return c.json({ message: "Error accepting group3" }, 500);
            }
            try {
                await createRemoteGroup(groupId, await groupData.json(), [
                    userId,
                ]);
            } catch (err) {
                return c.json({ message: "Error accepting group4" }, 500);
            }
        }
        await Member.create({
            groupId: groupId,
            userId: userId,
        });
        await JoinRequest.deleteOne({
            groupId: groupId,
            userId: userId,
        });
        return c.json(200);
    },
);
