import { Group, Member } from "../../models/groups/groups.ts";
import { authorizationMiddleware, MyEnv } from "../../userInfo.ts";
import { Hono } from "hono";
const app = new Hono<MyEnv>();
app.use("*", authorizationMiddleware);
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { load } from "@std/dotenv";
import { uuidv7 } from "npm:uuidv7";
import { fff } from "../../utils/foundationReq.ts";
import request from "../../models/request.ts";
import { createRemoteGroup } from "./utils.ts";

const env = await load();

export default app;

async function handleLocalGroupAccept(
  // deno-lint-ignore no-explicit-any
  c: any,
  // deno-lint-ignore no-explicit-any
  group: any,
  groupId: string,
  currentUser: string,
) {
  if (await Member.findOne({ groupId, userId: currentUser })) {
    return c.json({ message: "Unauthorized" }, 401);
  }
  if (group.type !== "private") {
    return c.json({ message: "Invalid group type" }, 400);
  }
  if (!group.invites.includes(currentUser)) {
    return c.json({ message: "Invalid request" }, 400);
  }
  await Group.updateOne({ groupId }, { $pull: { invites: currentUser } });
  await Member.create({ groupId, userId: currentUser, role: [] });
  await request.deleteOne({
    sender: group.owner,
    receiver: currentUser,
    type: "groupInvite",
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
        userId: currentUser,
        beforeEventId: group.beforeEventId,
      },
    }),
    uniqueDomains.filter((domain) => domain !== currentUser.split("@")[1]),
  );
  await Group.updateOne({ groupId }, { $set: { beforeEventId: eventId } });
  return c.json({ message: "success" });
}
app.post(
  "/",
  zValidator(
    "json",
    z.object({
      groupId: z.string(),
    }),
  ),
  async (c) => {
    const user = c.get("user");
    if (!user) {
      return c.json({ message: "Unauthorized" }, 401);
    }
    const { groupId } = c.req.valid("json");
    const currentUser = `${user.userName}@${env["domain"]}`;
    const group = await Group.findOne({ groupId });
    const groupDomain = groupId.split("@")[1];
    if (group && group.isOwner) {
      return await handleLocalGroupAccept(c, group, groupId, currentUser);
    }
    if (groupDomain === env["domain"]) {
      return c.json({ message: "Invalid group" }, 400);
    }
    try {
      const res = await fff(
        JSON.stringify({
          event: "t.group.invite.accept",
          eventId: uuidv7(),
          payload: {
            groupId,
            userId: currentUser,
          },
        }),
        [groupDomain],
      );
      if (Array.isArray(res) ? res[0].status !== 200 : true) {
        return c.json({ message: "Error accepting group2" }, 500);
      }
      let groupData: Response | undefined;
      if (!group) {
        groupData = await TakosFetch(
          `https://${groupDomain}/_takos/v1/group/all/${groupId}`,
        );
        if (groupData.status !== 200) {
          return c.json({ message: "Error accepting group3" }, 500);
        }
        await createRemoteGroup(groupId, await groupData.json(), [currentUser]);
        if (await Member.findOne({ groupId, userId: currentUser })) {
          return c.json({ message: "success" });
        } else {
          await Member.create({
            groupId,
            userId: currentUser,
            role: [],
          });
          return c.json({ message: "success" });
        }
      } else {
        await Member.create({
          groupId,
          userId: currentUser,
          role: [],
        });
      }
      return c.json({ message: "success" });
    } catch (error) {
      console.error("Error accepting group:", error);
      return c.json({ message: "Error accepting group1" }, 500);
    }
  },
);
