import { z } from "zod";
import { handleUnbanUser } from "../../../web/groups/user/unban.ts";
import { eventManager } from "../eventManager.ts";
import { load } from "@std/dotenv";
const env = await load();

eventManager.add(
    "t.group.unban",
    z.object({
        userId: z.string().email(),
        groupId: z.string(),
        targetUserId: z.string().email(),
    }),
    async (c, payload) => {
        const domain = c.get("domain");
        const { userId, groupId, targetUserId } = payload;
        if (userId.split("@")[1] !== domain) {
            return c.json({ error: "Invalid userId" }, 400);
        }
        if (groupId.split("@")[1] !== env["domain"]) {
            return c.json({ error: "Invalid groupId" }, 400);
        }
        return await handleUnbanUser({
            groupId,
            userId: targetUserId,
            c: c,
            unbanner: userId,
        });
    },
);
