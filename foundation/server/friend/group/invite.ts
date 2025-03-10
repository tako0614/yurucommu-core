import { z } from "zod";
import { Member } from "../../../../models/groups/groups.ts";
import friends from "../../../../models/users/friends.ts";
import { eventManager } from "../../eventManager.ts";
import request from "../../../../models/request.ts";
import { load } from "@std/dotenv";
const env = await load();

eventManager.add(
  "t.friend.group.invite",
  z.object({
    userId: z.string().email(),
    groupId: z.string(),
    inviteUserId: z.string().email(),
  }),
  async (c, payload) => {
    const domain = c.get("domain");
    const { userId, groupId, inviteUserId } = payload;
    if (userId.split("@")[1] !== domain) {
      return c.json({ error: "Invalid userId" }, 400);
    }
    if (groupId.split("@")[1] == env["domain"]) {
      return c.json({ error: "Invalid groupId" }, 400);
    }
    if (!await friends.findOne({ userName: inviteUserId, friendId: userId })) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    if (await Member.findOne({ groupId: groupId, userId: inviteUserId })) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    await request.create({
      sender: userId,
      receiver: inviteUserId,
      type: "groupInvite",
      query: groupId,
      local: false,
    });

    return c.json(200);
  },
);
