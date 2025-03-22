import { z } from "zod";
import { Group, Member } from "../../../../models/groups/groups.ts";
import { eventManager } from "../../eventManager.ts";
import { load } from "@std/dotenv";
const env = await load();

eventManager.add(
    "t.group.join.request",
    z.object({
        userId: z.string(),
        groupId: z.string(),
    }),
    async (c, payload) => {
        const domain = c.get("domain");
        const { userId, groupId } = payload;
        if (userId.split("@")[1] !== domain) {
            return c.json({ error: "Invalid userId" }, 400);
        }
        if (groupId.split("@")[1] !== env["domain"]) {
            return c.json({ error: "Invalid groupId1" }, 400);
        }
        if (await Member.findOne({ groupId: groupId, userId: userId })) {
            return c.json({ error: "Already member" }, 400);
        }
        const group = await Group.findOne({ groupId });
        if (!group) {
            return c.json({ error: "Invalid groupId2" }, 400);
        }
        if (!group.isOwner) {
            return c.json({ error: "Invalid groupId3" }, 400);
        }
        if (group.requests.includes(userId)) {
            return c.json({ error: "Already requested" }, 400);
        }
        if (group.type === "public" && !group.allowJoin) {
            await Group.updateOne({ groupId }, { $push: { requests: userId } });
            return c.json(200);
        }
        return c.json({ error: "Invalid groupId4" }, 400);
    },
);
