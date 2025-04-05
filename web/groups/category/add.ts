import {
  Category,
  CategoryPermissions,
  Group,
  Member,
} from "../../../models/groups/groups.ts";
import { MyEnv } from "../../../userInfo.ts";
import { Hono } from "hono";
const app = new Hono<MyEnv>();
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { load } from "@std/dotenv";
import { uuidv7 } from "npm:uuidv7";
import { fff } from "../../../utils/foundationReq.ts";
import { getUserPermission } from "../../../utils/getUserPermission.ts";

const env = await load();

export default app;

app.post(
  "/",
  zValidator(
    "json",
    z.object({
      groupId: z.string(),
      name: z.string(),
      id: z.string(),
      permissions: z.array(
        z.object({
          roleId: z.string(),
          permissions: z.array(z.string()),
        }),
      ),
    }),
  ),
  async (c) => {
    const user = c.get("user");
    if (!user) {
      return c.json({ message: "Unauthorized1" }, 401);
    }
    const { groupId, name, id } = c.req.valid("json");
    const group = await Group.findOne({ groupId });
    if (!group) {
      return c.json({ message: "Invalid groupId" }, 400);
    }
    if (
      !await Member.findOne({
        groupId,
        userId: user.userName + "@" + env["domain"],
      })
    ) {
      return c.json({ message: "Unauthorized2" }, 401);
    }
    if (group.isOwner) {
      const permission = await getUserPermission(
        user.userName + "@" + env["domain"],
        c.req.valid("json").groupId,
      );
      if (!permission) {
        return c.json({ message: "Unauthorized1" }, 401);
      }
      if (
        !permission.includes(`MANAGE_CHANNEL`) &&
        !permission.includes(`ADMIN`)
      ) {
        return c.json({ message: "Unauthorized permission" }, 401);
      }
      await handleAddCategory({
        groupId,
        name,
        id,
        permissions: c.req.valid("json").permissions,
        beforeEventId: group.beforeEventId!,
      });
      return c.json({ message: "success" });
    } else {
      const res = await fff(
        JSON.stringify({
          event: "t.group.category.add",
          eventId: uuidv7(),
          payload: {
            groupId: groupId,
            userId: user.userName + "@" + env["domain"],
            categoryName: name,
            categoryId: id,
            permissions: c.req.valid("json").permissions,
          },
        }),
        [group.groupId.split("@")[1]],
      );
      if (Array.isArray(res) ? res[0].status !== 200 : true) {
        return c.json({ message: "Error adding category" }, 500);
      }
      return c.json({ message: "success" });
    }
  },
);

export async function handleAddCategory(
  { groupId, name, id, permissions, beforeEventId }: {
    groupId: string;
    name: string;
    id: string;
    permissions: { roleId: string; permissions: string[] }[];
    beforeEventId: string;
  },
) {
  const category = await Category.findOne({ id, groupId });
  if (category) {
    await Category.updateOne({ id }, { name });
  } else {
    await Category.create({ id, name, groupId });
  }
  await Category.updateOne({ id }, { name });
  await CategoryPermissions.deleteMany({ categoryId: id, groupId });
  if (permissions) {
    for (const roleId of permissions ?? []) {
      await CategoryPermissions.create({
        groupId,
        categoryId: id,
        roleId: roleId.roleId,
        permissions: roleId.permissions,
      });
    }
  }
  const MembersDomain = (await Member
    .find({ groupId }))
    .map((member: { userId: string }) => member.userId.split("@")[1])
    .filter((domain: string) => domain !== env["domain"]);
  const uniqueDomains = Array.from(new Set(MembersDomain));
  const eventId = uuidv7();
  await Group.updateOne({ groupId }, { $set: { beforeEventId: eventId } });
  await fff(
    JSON.stringify({
      event: "t.group.sync.category.add",
      eventId: eventId,
      payload: {
        groupId: groupId,
        categoryId: id,
        name,
        permissions: permissions,
        beforeEventId: beforeEventId,
      },
    }),
    uniqueDomains,
  );
  return;
}
