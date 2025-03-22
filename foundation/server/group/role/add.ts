import { z } from "zod";
import { Group } from "../../../../models/groups/groups.ts";
import { handleAddRole } from "../../../../web/groups/role/add.ts";
import { eventManager } from "../../eventManager.ts";
import { load } from "@std/dotenv";
const env = await load();

eventManager.add(
    "t.group.role.add",
    z.object({
        groupId: z.string(),
        userId: z.string(),
        roleName: z.string(),
        roleId: z.string(),
        color: z.string(),
        permissions: z.array(z.string()),
    }),
    async (c, payload) => {
        const domain = c.get("domain");
        const { groupId, userId, roleName, roleId, color, permissions } =
            payload;
        if (userId.split("@")[1] !== domain) {
            return c.json({ error: "Invalid userId" }, 400);
        }
        if (groupId.split("@")[1] !== env["domain"]) {
            return c.json({ error: "Invalid groupId" }, 400);
        }
        const group = await Group
            .findOne({ groupId });
        if (!group || !group.isOwner) {
            return c.json({ error: "Invalid groupId" }, 400);
        }
        return await handleAddRole({
            groupId,
            userId,
            name: roleName,
            id: roleId,
            color,
            permissions,
            context: c,
        });
    },
);
