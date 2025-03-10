import { Group, Member } from "../../models/groups/groups.ts";
import { MyEnv } from "../../userInfo.ts";
import { Hono } from "hono";
const app = new Hono<MyEnv>();
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { load } from "@std/dotenv";
import { uuidv7 } from "npm:uuidv7@^1.0.2";
import { fff } from "../../utils/foundationReq.ts";
import request from "../../models/request.ts";
import { getUserPermission } from "../../utils/getUserPermission.ts";
const env = await load();

app.post(
  "invite",
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
      return c.json({ message: "Unauthorized1" }, 401);
    }
    if (await Member.findOne({ groupId, userId })) {
      return c.json({ message: "Already exists" }, 400);
    }
    if (group.type !== "private") {
      return c.json({ message: "Invalid group type" }, 400);
    }
    if (group.invites.includes(userId)) {
      return c.json({ message: "Already invited" }, 400);
    }
    if (group.isOwner) {
      const permissions = await getUserPermission(
        user.userName + "@" + env["domain"],
        groupId,
      );
      if (
        !permissions ||
        !permissions.includes("INVITE_USER") && !permissions.includes("ADMIN")
      ) {
        return c.json({ message: "Unauthorized permission" }, 401);
      }
      await Group.updateOne({ groupId }, {
        $push: { invites: userId },
      });
    } else {
      const res = await fff(
        JSON.stringify({
          event: "t.group.invite.send",
          eventId: uuidv7(),
          payload: {
            groupId,
            userId: user.userName + "@" + env["domain"],
            inviteUserId: userId,
          },
        }),
        [group.groupId.split("@")[1]],
      );
      if (Array.isArray(res) ? res[0].status !== 200 : true) {
        return c.json({ message: "Error inviting user1" }, 500);
      }
    }
    if (userId.split("@")[1] !== env["domain"]) {
      const res = await fff(
        JSON.stringify({
          event: "t.friend.group.invite",
          eventId: uuidv7(),
          payload: {
            groupId,
            userId: user.userName + "@" + env["domain"],
            inviteUserId: userId,
          },
        }),
        [userId.split("@")[1]],
      );
      if (Array.isArray(res) ? res[0].status !== 200 : true) {
        return c.json({ message: "Error inviting user2" }, 500);
      }
    } else {
      await request.create({
        sender: user.userName + "@" + env["domain"],
        receiver: userId,
        type: "groupInvite",
        local: false,
        query: groupId,
      });
    }
    return c.json({ message: "success" });
  },
);

export default app;
