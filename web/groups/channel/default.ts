import { Channels, Group } from "../../../models/groups/groups.ts";
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
      channelId: z.string(),
    }),
  ),
  async (c) => {
    const user = c.get("user");
    if (!user) {
      return c.json({ message: "Unauthorized" }, 401);
    }
    const { groupId, channelId } = c.req.valid("json");
    if (groupId.split("@")[1] === env["domain"]) {
      return await handleSetDefaultChannel({
        groupId,
        channelId,
        c,
      });
    } else {
      const res = await fff(
        JSON.stringify({
          event: "t.group.channel.default",
          eventId: uuidv7(),
          payload: {
            groupId,
            userId: user.userName + "@" + env["domain"],
            channelId,
          },
        }),
        [groupId.split("@")[1]],
      );
      if (Array.isArray(res) ? res[0].status !== 200 : true) {
        return c.json(
          { message: "Error setting default channel" },
          500,
        );
      }
      return c.json({ message: "success" });
    }
  },
);

export async function handleSetDefaultChannel({
  groupId,
  channelId,
  c,
}: {
  groupId: string;
  channelId: string;
  c: Context;
}) {
  const group = await Group.findOne({ groupId });
  if (!group) {
    return c.json({ message: "Invalid groupId" }, 400);
  }
  if (
    !await Channels.findOne({ groupId, id: channelId })
  ) {
    return c.json({ message: "Invalid channelId" }, 400);
  }
  const permission = await getUserPermission(
    c.get("user").userName + "@" + env["domain"],
    groupId,
  );
  if (!permission) {
    return c.json({ message: "Unauthorized1" }, 401);
  }
  if (
    !permission.includes(`ADMIN`) && !permission.includes(`MANAGE_CHANNEL`)
  ) {
    return c.json({ message: "Unauthorized permission" }, 401);
  }
  await Group.updateOne({ groupId }, {
    $set: { defaultChannelId: channelId },
  });
  return c.json({ message: "success" });
}

export default app;
