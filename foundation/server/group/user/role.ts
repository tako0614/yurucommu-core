import { z } from "zod";
import { Group } from "../../../../models/groups/groups.ts";
import { handleGiveRole } from "../../../../web/groups/role/user.ts";
import { eventManager } from "../../eventManager.ts";
import { load } from "@std/dotenv";
const env = await load();

eventManager.add(
  "t.group.user.role",
  z.object({
    groupId: z.string(),
    userId: z.string(),
    assignUserId: z.string(),
    roleId: z.array(z.string()),
  }),
  async (c, payload) => {
    const domain = c.get("domain");
    const { groupId, userId, assignUserId, roleId } = payload;
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
    return await handleGiveRole({
      groupId,
      userId,
      targetUserId: assignUserId,
      roleId,
      c: c,
      beforeEventId: group.beforeEventId!,
    });
  },
);
