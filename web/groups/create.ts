import {
  ChannelPermissions,
  Channels,
  Group,
  Member,
  Roles,
} from "../../models/groups/groups.ts";
import { MyEnv } from "../../userInfo.ts";
import { Hono } from "hono";
const app = new Hono<MyEnv>();
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { load } from "@std/dotenv";
import { uuidv7 } from "npm:uuidv7@^1.0.2";
import {
  arrayBufferToBase64,
  base64ToArrayBuffer,
} from "https://jsr.io/@takos/takos-encrypt-ink/5.3.2/utils/buffers.ts";
import { resizeImageTo256x256 } from "../sessions/utils.ts";

const env = await load();

export default app;

app.post(
  "create",
  zValidator(
    "json",
    z.object({
      name: z.string(),
      icon: z.string(),
      groupid: z.string().optional(),
      isPublic: z.boolean(),
    }),
  ),
  async (c) => {
    const user = c.get("user");
    if (!user) {
      return c.json({ message: "Unauthorized" }, 401);
    }
    const { name, icon, groupid, isPublic } = c.req.valid("json");
    const domain = env["domain"];
    const id = groupid || uuidv7();
    const groupId = id + "@" + domain;
    try {
      const resizedIcon = await resizeImageTo256x256(
        new Uint8Array(base64ToArrayBuffer(icon)),
      );
      const buffer = resizedIcon.buffer;
      await Group.create({
        groupId,
        groupName: name,
        groupIcon: arrayBufferToBase64(buffer as ArrayBuffer),
        type: isPublic ? "public" : "private",
        owner: user.userName + "@" + env["domain"],
        isOwner: true,
        defaultChannelId: "general",
        allowJoin: false,
      });
    } catch (error) {
      console.error("Error resizing image:", error);
      return c.json({ message: "Error resizing image" }, 500);
    }
    await Channels.create({
      id: "general",
      name: "general",
      groupId: groupId,
    });
    await ChannelPermissions.create({
      groupId,
      channelId: "general",
      roleId: "everyone",
      permissions: [`SEND_MESSAGE`, `READ_MESSAGE`],
    });
    await Member.create({
      groupId,
      userId: user.userName + "@" + env["domain"],
      role: [],
    });
    await Roles.create({
      groupId,
      id: "everyone",
      name: "everyone",
      color: "#000000",
      permissions: [],
    });
    return c.json({ groupId });
  },
);
