// Community-related routes

import { Hono } from "hono";
import type {
  PublicAccountBindings as Bindings,
  Variables,
} from "@takos/platform/server";
import { ok, fail } from "@takos/platform/server";
import { auth } from "../middleware/auth";
import { makeData } from "../data";

const communities = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Get community channels
communities.get("/communities/:id/channels", auth, async (c) => {
  const store = makeData(c.env as any, c);
  const user = c.get("user") as any;
  const community_id = c.req.param("id");
  const community = await store.getCommunity(community_id);
  if (!community) return fail(c, "community not found", 404);
  if (!(await store.hasMembership(community_id, user.id))) {
    return fail(c, "forbidden", 403);
  }
  const list = await store.listChannelsByCommunity(community_id);
  // ensure at least 'general' exists
  if (!list.find((x: any) => x.id === "general")) {
    await store.createChannel(community_id, {
      id: "general",
      name: "general",
      created_at: new Date().toISOString(),
    });
  }
  const final = await store.listChannelsByCommunity(community_id);
  return ok(c, final);
});

export default communities;
