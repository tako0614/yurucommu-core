import {
  ChannelPermissions,
  Channels,
  Group,
  Member,
} from "../../../models/groups/groups.ts";
import { authorizationMiddleware, MyEnv } from "../../../userInfo.ts";
import { Hono } from "hono";
const app = new Hono<MyEnv>();
app.use("*", authorizationMiddleware);
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
      channelId: z.string(),
    }),
  ),
  async (c) => {
    const user = c.get("user");
    if (!user) {
      return c.json({ message: "Unauthorized1" }, 401);
    }
    const { groupId, channelId } = c.req.valid("json");
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
        !permission.includes(`MANAGE_CHANNEL`) && !permission.includes(`ADMIN`)
      ) {
        return c.json({ message: "Unauthorized permission" }, 401);
      }
      await handleRemoveChannel({
        groupId,
        channelId,
        beforeEventId: group.beforeEventId!,
      });
      return c.json({ message: "success" });
    } else {
      const res = await fff(
        JSON.stringify({
          event: "t.group.channel.remove",
          eventId: uuidv7(),
          payload: {
            groupId: groupId,
            userId: user.userName + "@" + env["domain"],
            channelId: channelId,
          },
        }),
        [group.groupId.split("@")[1]],
      );
      if (Array.isArray(res) ? res[0].status !== 200 : true) {
        return c.json({ message: "Error removing channel" }, 500);
      }
      return c.json({ message: "success" });
    }
  },
);

export async function handleRemoveChannel(
  {
    groupId,
    channelId,
    beforeEventId,
  }: {
    groupId: string;
    channelId: string;
    beforeEventId: string;
  },
) {
  await Channels.deleteOne({ id: channelId, groupId });
  await ChannelPermissions.deleteMany({ channelId, groupId });
  const MembersDomain = (await Member
    .find({ groupId }))
    .map((member: { userId: string }) => member.userId.split("@")[1])
    .filter((domain: string) => domain !== env["domain"]);
  const uniqueDomains = Array.from(new Set(MembersDomain));
  const eventId = uuidv7();
  await Group.updateOne({ groupId }, { $set: { beforeEventId: eventId } });
  await fff(
    JSON.stringify({
      event: "t.group.sync.channel.remove",
      eventId: eventId,
      payload: {
        groupId: groupId,
        channelId: channelId,
        beforeEventId: beforeEventId,
      },
    }),
    uniqueDomains,
  );
}
