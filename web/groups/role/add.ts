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
      name: z.string(),
      id: z.string(),
      color: z.string(),
      permissions: z.array(z.string()),
    }),
  ),
  async (c) => {
    const user = c.get("user");
    if (!user) {
      return c.json({ message: "Unauthorized1" }, 401);
    }
    const { groupId, name, id, color, permissions } = c.req.valid("json");
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
      return await handleAddRole({
        groupId,
        userId: user.userName + "@" + env["domain"],
        name,
        id,
        color,
        permissions,
        context: c,
      });
    } else {
      const res = await fff(
        JSON.stringify({
          event: "t.group.role.add",
          eventId: uuidv7(),
          payload: {
            groupId,
            userId: user.userName + "@" + env["domain"],
            roleName: name,
            roleId: id,
            color,
            permissions,
          },
        }),
        [group.groupId.split("@")[1]],
      );
      if (Array.isArray(res) ? res[0].status !== 200 : true) {
        return c.json({ message: "Error adding role" }, 500);
      }
      return c.json({ message: "success" });
    }
  },
);

export async function handleAddRole({
  groupId,
  userId,
  name,
  id,
  color,
  permissions,
  context,
}: {
  groupId: string;
  userId: string;
  name: string;
  id: string;
  color: string;
  permissions: string[];
  context: Context;
}) {
  const c = context;
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
  const role = await Roles.findOne({ id, groupId });
  if (role) {
    await Roles.updateOne({ id, groupId }, { name, color, permissions });
  } else {
    await Roles.create({ id, name, color, permissions, groupId });
  }
  return c.json({ message: "success" });
}
