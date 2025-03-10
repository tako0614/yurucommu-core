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
      categoryId: z.string(),
    }),
  ),
  async (c) => {
    const user = c.get("user");
    if (!user) {
      return c.json({ message: "Unauthorized1" }, 401);
    }
    const { groupId, categoryId } = c.req.valid("json");
    const group = await Group.findOne({ groupId });
    if (!group) {
      return c.json({ message: "Invalid groupId" }, 400);
    }
    const member = await Member.findOne({
      groupId,
      userId: user.userName + "@" + env["domain"],
    });
    if (!member) {
      return c.json({ message: "Unauthorized2" }, 401);
    }
    if (group.isOwner) {
      const permission = await getUserPermission(
        user.userName + "@" + env["domain"],
        groupId,
      );
      if (!permission) {
        return c.json({ message: "Unauthorized1" }, 401);
      }
      if (
        !permission.includes(`MANAGE_CHANNEL`) && !permission.includes(`ADMIN`)
      ) {
        return c.json({ message: "Unauthorized permission" }, 401);
      }
      const category = await Category.findOne({ id: categoryId, groupId });
      if (!category) {
        return c.json({ message: "Invalid categoryId" }, 400);
      }
      await handleRemoveCategory({
        groupId,
        categoryId,
        beforeEventId: group.beforeEventId!,
      });
      return c.json({ message: "success" });
    } else {
      const res = await fff(
        JSON.stringify({
          event: "t.group.category.remove",
          eventId: uuidv7(),
          payload: {
            groupId,
            userId: user.userName + "@" + env["domain"],
            categoryId,
          },
        }),
        [group.groupId.split("@")[1]],
      );
      if (Array.isArray(res) ? res[0].status !== 200 : true) {
        return c.json({ message: "Error removing category" }, 500);
      }
      console.log("success");
      return c.json({ message: "success" });
    }
  },
);

export async function handleRemoveCategory(
  { groupId, categoryId, beforeEventId }: {
    groupId: string;
    categoryId: string;
    beforeEventId: string;
  },
) {
  await Category.deleteOne({ id: categoryId, groupId });
  await CategoryPermissions.deleteMany({ categoryId, groupId });
  const MembersDomain = (await Member
    .find({ groupId }))
    .map((member: { userId: string }) => member.userId.split("@")[1])
    .filter((domain: string) => domain !== env["domain"]);
  const uniqueDomains = Array.from(new Set(MembersDomain));
  const eventId = uuidv7();
  await Group.updateOne({ groupId }, { $set: { beforeEventId: eventId } });
  await fff(
    JSON.stringify({
      event: "t.group.sync.category.remove",
      eventId: eventId,
      payload: {
        groupId,
        categoryId,
        beforeEventId: beforeEventId,
      },
    }),
    uniqueDomains,
  );
}
