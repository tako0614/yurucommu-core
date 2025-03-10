import { Group, Member, Roles } from "../../../models/groups/groups.ts";
import { MyEnv } from "../../../userInfo.ts";
import { Context, Hono } from "hono";
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
      roleId: z.string(),
    }),
  ),
  async (c) => {
    const user = c.get("user");
    if (!user) {
      return c.json({ message: "Unauthorized1" }, 401);
    }
    const { groupId, roleId } = c.req.valid("json");
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
      return await handleRemoveRole({
        groupId,
        roleId,
        userId: user.userName + "@" + env["domain"],
        beforeEventId: group.beforeEventId!,
        c,
      });
    } else {
      const res = await fff(
        JSON.stringify({
          event: "t.group.role.remove",
          eventId: uuidv7(),
          payload: {
            groupId,
            userId: user.userName + "@" + env["domain"],
            roleId,
          },
        }),
        [group.groupId.split("@")[1]],
      );
      if (Array.isArray(res) ? res[0].status !== 200 : true) {
        return c.json({ message: "Error removing role" }, 500);
      }
      return c.json({ message: "success" });
    }
  },
);

export async function handleRemoveRole({
  groupId,
  roleId,
  userId,
  beforeEventId,
  c,
}: {
  groupId: string;
  roleId: string;
  userId: string;
  c: Context;
  beforeEventId: string;
}) {
  if (roleId === "everyone") {
    return c.json({ message: "Invalid roleId" }, 400);
  }
  const role = await Roles.findOne({ id: roleId, groupId });
  if (!role) {
    return c.json({ message: "Invalid roleId" }, 400);
  }
  const permission = await getUserPermission(
    userId,
    groupId,
  );
  if (!permission) {
    return c.json({ message: "Unauthorized1" }, 401);
  }
  if (!permission.includes(`ADMIN`)) {
    return c.json({ message: "Unauthorized permission" }, 401);
  }
  await Roles.deleteOne({ id: roleId, groupId });
  await Member.updateMany({ groupId }, { $pull: { role: roleId } });
  const MembersDomain = (await Member.find({ groupId }))
    .map((member: { userId: string }) => member.userId.split("@")[1])
    .filter((domain: string) => domain !== env["domain"]);
  const uniqueDomains = Array.from(new Set(MembersDomain));
  const eventId = uuidv7();
  await Group.updateOne({ groupId }, { $set: { beforeEventId: eventId } });
  await fff(
    JSON.stringify({
      event: "t.group.sync.role.remove",
      eventId: eventId,
      payload: {
        groupId,
        roleId,
        beforeEventId: beforeEventId,
      },
    }),
    uniqueDomains,
  );
  return c.json({ message: "success" });
}
