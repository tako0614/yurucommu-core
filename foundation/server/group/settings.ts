import { z } from "zod";
import { handleSettings } from "../../../web/groups/settings.ts";
import { eventManager } from "../eventManager.ts";
import { load } from "@std/dotenv";
const env = await load();

eventManager.add(
  "t.group.settings",
  z.object({
    userId: z.string().email(),
    groupId: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
    allowJoin: z.boolean().optional(),
    icon: z.string().optional(),
  }),
  async (c, payload) => {
    const domain = c.get("domain");
    const { userId, groupId, name, description, allowJoin, icon } = payload;
    if (userId.split("@")[1] !== domain) {
      return c.json({ error: "Invalid userId" }, 400);
    }
    if (groupId.split("@")[1] !== env["domain"]) {
      return c.json({ error: "Invalid groupId" }, 400);
    }
    return await handleSettings({
      groupId,
      userId,
      c: c,
      name,
      description,
      allowJoin,
      icon,
    });
  },
);
