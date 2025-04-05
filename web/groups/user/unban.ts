import { Group } from "../../../models/groups/groups.ts";
import { Context, Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { load } from "@std/dotenv";
import { uuidv7 } from "npm:uuidv7";
import { fff } from "../../../utils/foundationReq.ts";
import { getUserPermission } from "../../../utils/getUserPermission.ts";
import { MyEnv } from "../../../userInfo.ts";

const env = await load();
const app = new Hono<MyEnv>();

app.post(
  "/",
  zValidator(
    "json",
    z.object({
      groupId: z.string(),
      userId: z.string(),
    }),
  ),
  async (c) => {
    const user = c.get("user");
    if (!user) {
      return c.json({ message: "Unauthorized" }, 401);
    }
    const { groupId, userId } = c.req.valid("json");
    if (groupId.split("@")[1] === env["domain"]) {
      return await handleUnbanUser({
        groupId,
        userId,
        c,
        unbanner: user.userName + "@" + env["domain"],
      });
    } else {
      const res = await fff(
        JSON.stringify({
          event: "t.group.unban",
          eventId: uuidv7(),
          payload: {
            groupId,
            userId: user.userName + "@" + env["domain"],
            targetUserId: userId,
          },
        }),
        [groupId.split("@")[1]],
      );
      if (Array.isArray(res) ? res[0].status !== 200 : true) {
        return c.json({ message: "Error unbanning user" }, 500);
      }
      return c.json({ message: "success" });
    }
  },
);

export async function handleUnbanUser({
  groupId,
  userId,
  c,
  unbanner,
}: {
  groupId: string;
  userId: string;
  c: Context;
  unbanner: string;
}) {
  const group = await Group.findOne({ groupId });
  if (!group) {
    return c.json({ message: "Invalid groupId" }, 400);
  }
  if (!group.ban.includes(userId)) {
    return c.json({ message: "Not banned" }, 400);
  }
  const permission = await getUserPermission(
    unbanner,
    groupId,
  );
  if (!permission) {
    return c.json({ message: "Unauthorized1" }, 401);
  }
  if (!permission.includes(`ADMIN`) && !permission.includes(`MANAGE_USER`)) {
    return c.json({ message: "Unauthorized permission" }, 401);
  }
  await Group.updateOne({ groupId }, { $pull: { ban: userId } });
  return c.json({ message: "success" });
}

export default app;
