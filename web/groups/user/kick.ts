import { Group, Member } from "../../../models/groups/groups.ts";
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
      return await handleKickUser({
        groupId,
        userId,
        c: c,
        kikker: user.userName + "@" + env["domain"],
      });
    } else {
      const res = await fff(
        JSON.stringify({
          event: "t.group.kick",
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
        return c.json({ message: "Error kicking user" }, 500);
      }
      return c.json({ message: "success" });
    }
  },
);

export async function handleKickUser({
  groupId,
  userId,
  c,
  kikker,
}: {
  groupId: string;
  userId: string;
  c: Context;
  kikker: string;
}) {
  const group = await Group.findOne({ groupId });
  if (!group) {
    return c.json({ message: "Invalid groupId" }, 400);
  }
  if (
    !await Member
      .findOne({ groupId, userId })
  ) {
    return c.json({ message: "Not a member" }, 400);
  }
  if (group.owner === userId) {
    return c.json({ message: "Cannot ban kick" }, 400);
  }
  const permission = await getUserPermission(
    kikker,
    groupId,
  );
  if (!permission) {
    return c.json({ message: "Unauthorized1" }, 401);
  }
  if (!permission.includes(`ADMIN`) && !permission.includes(`MANAGE_USER`)) {
    return c.json({ message: "Unauthorized permission" }, 401);
  }
  await Member
    .deleteOne({ groupId, userId });
  const MembersDomain = (await Member
    .find({
      groupId,
    }))
    .map((member) => member.userId.split("@")[1])
    .filter((domain) => domain !== env["domain"]);
  const uniqueDomains = Array.from(new Set(MembersDomain));
  const eventId = uuidv7();
  await Group
    .updateOne({ groupId }, { $set: { beforeEventId: eventId } });
  await fff(
    JSON.stringify({
      event: "t.group.sync.user.remove",
      eventId: eventId,
      payload: {
        groupId,
        userId,
        beforeEventId: group.beforeEventId!,
      },
    }),
    uniqueDomains,
  );
  return c.json({ message: "success" });
}
