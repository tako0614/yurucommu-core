import { z } from "zod";
import {
  Category,
  CategoryPermissions,
  Group,
} from "../../../../../models/groups/groups.ts";
import { handleReCreateGroup } from "../../../../../web/groups/utils.ts";
import { eventManager } from "../../../eventManager.ts";
import { load } from "@std/dotenv";
const env = await load();

eventManager.add(
  "t.group.sync.category.add",
  z.object({
    groupId: z.string(),
    categoryId: z.string(),
    permissions: z.array(
      z.object({
        roleId: z.string(),
        permissions: z.array(z.string()),
      }),
    ),
    beforeEventId: z.string(),
  }),
  async (c, payload) => {
    const domain = c.get("domain");
    const eventId = c.get("eventId");
    const { groupId, categoryId, permissions } = payload;
    if (groupId.split("@")[1] === env["domain"]) {
      return c.json({ error: "Invalid groupId" }, 400);
    }
    if (domain !== groupId.split("@")[1]) {
      return c.json({ error: "Invalid groupId1" }, 400);
    }
    const group = await Group.findOne({
      groupId: groupId,
    });
    if (!group) {
      return c.json({ error: "Invalid groupId2" }, 400);
    }
    const channel = await Category.findOne({
      groupId: groupId,
      id: categoryId,
    });
    if (group.beforeEventId !== payload.beforeEventId) {
      await handleReCreateGroup(groupId, eventId);
      return c.json(200);
    }
    console.log(-1);
    if (channel) {
      await CategoryPermissions.deleteMany({
        groupId: groupId,
        categoryId: categoryId,
      });
      for (const permission of permissions ?? []) {
        await CategoryPermissions.create({
          groupId: groupId,
          categoryId: categoryId,
          roleId: permission.roleId,
          permissions: permission.permissions,
        });
      }
    } else {
      // チャンネルが存在しない場合は新規作成
      console.log(1);
      await Category.create({
        groupId: groupId,
        id: categoryId,
      });
      console.log(2);
      for (const permission of permissions ?? []) {
        await CategoryPermissions.create({
          groupId: groupId,
          categoryId: categoryId,
          roleId: permission.roleId,
          permissions: permission.permissions,
        });
      }
      console.log(3);
    }
    await Group.updateOne({ groupId }, { beforeEventId: eventId });
    return c.json(200);
  },
);
