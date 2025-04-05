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
      return await handleBanUser({
        groupId,
        userId,
        c: c,
        bannner: user.userName + "@" + env["domain"],
      });
    } else {
      const res = await fff(
        JSON.stringify({
          event: "t.group.ban",
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
        return c.json({ message: "Error banning user" }, 500);
      }
      return c.json({ message: "success" });
    }
  },
);

export async function handleBanUser({
  groupId,
  userId,
  c,
  bannner,
}: {
  groupId: string;
  userId: string;
  c: Context;
  bannner: string;
}) {
  const group = await Group.findOne({ groupId });
  if (!group) {
    return c.json({ message: "Invalid groupId" }, 400);
  }
  const permission = await getUserPermission(
    bannner,
    groupId,
  );
  if (!permission) {
    return c.json({ message: "Unauthorized1" }, 401);
  }
  if (!permission.includes(`ADMIN`) && !permission.includes(`MANAGE_USER`)) {
    return c.json({ message: "Unauthorized permission" }, 401);
  }
  if (group.owner === userId) {
    return c.json({ message: "Cannot ban owner" }, 400);
  }
  if (group.ban.includes(userId)) {
    return c.json({ message: "Already banned" }, 400);
  }
  if (
    await Member
      .findOne({ groupId, userId })
  ) {
    await Member
      .deleteOne({ groupId, userId });
    await Group.updateOne({ groupId }, { $push: { ban: userId } });
    const MembersDomain = (await Member
      .find({ groupId }))
      .map((member) => member.userId.split("@")[1])
      .filter((domain) => domain !== env["domain"]);
    const uniqueDomains = Array.from(new Set(MembersDomain));
    const eventId = uuidv7();
    await Group.updateOne({ groupId }, {
      $set: { beforeEventId: eventId },
    });
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
  }
  return c.json({ message: "success" });
}
