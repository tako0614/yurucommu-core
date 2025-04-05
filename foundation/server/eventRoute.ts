import app from "../../foundation.ts";
import z from "zod";
import { zValidator } from "@hono/zod-validator";
import { eventManager } from "./eventManager.ts";
import "./message/send.ts";
import "./friend/accept.ts";
import "./friend/cannsel.ts";
import "./friend/group/accept.ts";
import "./friend/group/invite.ts";
import "./friend/request.ts";
import "./friend/call/request.ts";
import "./friend/call/accept.ts";
import "./friend/call/reject.ts";
import "./group/ban.ts";
import "./group/kick.ts";
import "./group/unban.ts";
import "./group/role/add.ts";
import "./group/role/remove.ts";
import "./group/user/role.ts";
import "./group/settings.ts";
import "./group/sync/category/add.ts";
import "./group/sync/category/remove.ts";
import "./group/sync/channel/add.ts";
import "./group/sync/channel/remove.ts";
import "./group/sync/role/assign.ts";
import "./group/sync/role/remove.ts";
import "./group/sync/user/add.ts";
import "./group/sync/user/remove.ts";
import "./group/invite/send.ts";
import "./group/invite/accept.ts";
import "./group/invite/cancel.ts";
import "./group/channel/add.ts";
import "./group/channel/remove.ts";
import "./group/category/add.ts";
import "./group/category/remove.ts";
import "./group/join/request.ts";
import "./group/join/accept.ts";
import "./group/leave.ts";
export default app.post(
  "/",
  zValidator(
    "json",
    z.object({
      event: z.string(),
      eventId: z.string(),
      payload: z.object({}).passthrough(),
    }),
  ),
  async (c) => {
    try {
      return await eventManager.dispatch(c);
    } catch (err) {
      console.error(err);
      return c.json({ error: "Internal server error" }, 500);
    }
  },
);
