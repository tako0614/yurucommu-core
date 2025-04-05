import { z } from "zod";
import { Group } from "../../../../models/groups/groups.ts";
import { handleRemoveRole } from "../../../../web/groups/role/delete.ts";
import { eventManager } from "../../eventManager.ts";
import { load } from "@std/dotenv";
const env = await load();

eventManager.add(
  "t.group.role.remove",
  z.object({
    groupId: z.string(),
    userId: z.string(),
    roleId: z.string(),
  }),
  async (c, payload) => {
    const domain = c.get("domain");
    const { groupId, userId, roleId } = payload;
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
    return await handleRemoveRole({
      groupId,
      userId,
      roleId,
      c: c,
      beforeEventId: group.beforeEventId!,
    });
  },
);
