import { z } from "zod";
import {
  ChannelPermissions,
  Channels,
  Group,
} from "../../../../../models/groups/groups.ts";
import { handleReCreateGroup } from "../../../../../web/groups/utils.ts";
import { eventManager } from "../../../eventManager.ts";
import { load } from "@std/dotenv";
const env = await load();

eventManager.add(
  "t.group.sync.channel.remove",
  z.object({
    groupId: z.string(),
    channelId: z.string(),
    beforeEventId: z.string(),
  }),
  async (c, payload) => {
    const domain = c.get("domain");
    const eventId = c.get("eventId");
    const { groupId, channelId } = payload;
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
    const channel = await Channels.findOne({
      groupId: groupId,
      id: channelId,
    });
    if (!channel) {
      return c.json({ error: "Not channel" }, 400);
    }
    if (group.beforeEventId !== payload.beforeEventId) {
      await handleReCreateGroup(groupId, eventId);
      return c.json(200);
    }
    await Channels.deleteOne({
      groupId: groupId,
      id: channelId,
    });
    await ChannelPermissions.deleteMany({
      groupId: groupId,
      channelId: channelId,
    });
    await Group.updateOne({ groupId }, { beforeEventId: eventId });
    return c.json(200);
  },
);
