import { z } from "zod";
import { Category, Group, Member } from "../../../../models/groups/groups.ts";
import { handleAddChannel } from "../../../../web/groups/channel/add.ts";
import { eventManager } from "../../eventManager.ts";
import { getUserPermission } from "../../../../utils/getUserPermission.ts";
import { load } from "@std/dotenv";
const env = await load();

eventManager.add(
  "t.group.channel.add",
  z.object({
    groupId: z.string(),
    userId: z.string(),
    channelName: z.string(),
    channelId: z.string(),
    categoryId: z.string(),
    permissions: z.array(z.object({
      roleId: z.string(),
      permissions: z.array(z.string()),
    })),
  }),
  async (c, payload) => {
    const domain = c.get("domain");
    const { groupId, userId, channelName, channelId, categoryId, permissions } =
      payload;
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
    console.log(permission);
    if (
      !permission.includes(`MANAGE_CHANNEL`) && !permission.includes(`ADMIN`)
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
    if (categoryId) {
      if (!await Category.findOne({ id: categoryId, groupId })) {
        return c.json({ message: "Invalid categoryId" }, 400);
      }
    }
    await handleAddChannel(
      {
        groupId,
        name: channelName,
        id: channelId,
        categoryId,
        permissions,
        beforeEventId: group.beforeEventId!,
      },
    );
    return c.json(200);
  },
);
