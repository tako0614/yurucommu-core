import { Group, Member } from "../../../models/groups/groups.ts";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { load } from "@std/dotenv";
import { uuidv7 } from "npm:uuidv7";
import { fff } from "../../../utils/foundationReq.ts";
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
      if (userId.split("@")[1] !== env["domain"]) {
        return c.json({ message: "Invalid userId" }, 400);
      }
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
        return c.json({ message: "Already owner" }, 400);
      }
      await Group.updateOne({ groupId }, { $set: { owner: userId } });
      await fff(
        JSON.stringify({
          event: "t.group.sync.owner",
          eventId: uuidv7(),
          payload: {
            groupId,
            userId,
          },
        }),
        [userId.split("@")[1]],
      );
      return c.json({ message: "success" });
    } else {
      return c.json({ message: "Unauthorized" }, 401);
    }
  },
);

export default app;
