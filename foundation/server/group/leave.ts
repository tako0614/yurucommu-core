import { uuidv7 } from "npm:uuidv7@^1.0.2";
import { z } from "zod";
import { Group, Member } from "../../../models/groups/groups.ts";
import { fff } from "../../../utils/foundationReq.ts";
import { eventManager } from "../eventManager.ts";
import { getGroupMemberServers } from "../../../utils/getUserPermission.ts";

import { load } from "@std/dotenv";
const env = await load();

eventManager.add(
  "t.group.leave",
  z.object({
    userId: z.string().email(),
    groupId: z.string(),
  }),
  async (c, payload) => {
    const domain = c.get("domain");
    const { userId, groupId } = payload;
    if (userId.split("@")[1] !== domain) {
      console.log(userId.split("@")[1], domain);
      return c.json({ error: "Invalid userId1" }, 400);
    }
    if (groupId.split("@")[1] !== env["domain"]) {
      return c.json({ error: "Invalid groupId" }, 400);
    }
    const group = await Group.findOne({ groupId });
    if (!group) {
      return c.json({ error: "Invalid groupId" }, 400);
    }
    if (group.isOwner) {
      const member = await Member.findOne({ groupId: groupId, userId: userId });
      if (!member) {
        return c.json({ error: "Invalid userId2" }, 400);
      }
      await Member.deleteOne({ groupId: groupId, userId: userId });
      await fff(
        JSON.stringify({
          event: "t.group.sync.user.remove",
          eventId: uuidv7(),
          payload: {
            userId: userId,
            groupId: groupId,
            beforeEventId: group.beforeEventId,
          },
        }),
        await getGroupMemberServers(groupId),
      );
      return c.json(200);
    } else {
      return c.json({ error: "Invalid groupId" }, 400);
    }
  },
);
