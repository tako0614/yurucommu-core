import { Hono } from "hono";
import { Env } from "./index.ts";
// src/api/event.ts
import z from "zod";
import { zValidator } from "@hono/zod-validator";
import { eventManager } from "./eventManager.ts";

const app = new Hono<{ Bindings: Env }>();

export default app.post(
  "/api/event",
  zValidator(
    "json",
    z.object({
      events: z.array(
        z.object({
          eventId: z.string(),
          identifier: z.string(),
          payload: z.object({}).passthrough(),
        }),
      ),
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