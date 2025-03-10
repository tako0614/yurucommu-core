import { uuidv7 } from "npm:uuidv7@^1.0.2";
import { z } from "zod";
import { Group, Member } from "../../../../models/groups/groups.ts";
import { fff } from "../../../../utils/foundationReq.ts";
import { eventManager } from "../../eventManager.ts";
import { load } from "@std/dotenv";
const env = await load();

eventManager.add(
  "t.group.invite.accept",
  z.object({
    userId: z.string().email(),
    groupId: z.string(),
  }),
  async (c, payload) => {
    const domain = c.get("domain");
    const { userId, groupId } = payload;
    if (userId.split("@")[1] !== domain) {
      console.log("error1");
      return c.json({ error: "Invalid userId" }, 400);
    }
    if (groupId.split("@")[1] !== env["domain"]) {
      console.log("error2");
      return c.json({ error: "Invalid groupId" }, 400);
    }
    const group = await Group.findOne({ groupId: groupId });
    if (!group || !group.invites.includes(userId)) {
      return c.json({ error: "Invalid groupId" }, 400);
    }
    await Member.create({
      groupId: groupId,
      userId: userId,
    });
    const domains = (await Member.find({ groupId })).map((member) =>
      member.userId.split("@")[1]
    ).filter((domain) => domain !== env["domain"]);
    const uniqueDomains = Array.from(new Set(domains));
    const eventId = uuidv7();
    await fff(
      JSON.stringify({
        event: "t.group.sync.user.add",
        eventId: eventId,
        payload: {
          groupId,
          userId: userId,
          beforeEventId: group.beforeEventId,
          role: [],
        },
      }),
      uniqueDomains,
    );
    await Group.updateOne({ groupId }, {
      $pull: { invites: userId },
      $set: { beforeEventId: eventId },
    });
    return c.json(200);
  },
);
