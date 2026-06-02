/**
 * Takos Tools Endpoint
 *
 * Provides tool endpoints for AI agent integration.
 * POST /.takos/tools/:name - Execute a tool
 *
 * Each tool category is implemented in a dedicated module under ./takos-tools/.
 */

import { Hono } from "hono";
import type { Env, Variables } from "../types.ts";
import type { ToolResponse } from "./takos-tools-response.ts";
import { logger } from "../lib/logger.ts";

// Handler modules
import {
  handleGetTrending,
  handleGetUserProfile,
  handleSearchPosts,
  handleSearchUsers,
} from "./takos-tools/search.ts";
import {
  handleBookmarkPost,
  handleCreatePost,
  handleDeletePost,
  handleLikePost,
} from "./takos-tools/posts.ts";
import {
  handleFollowUser,
  handleGetFollowList,
  handleUnfollowUser,
} from "./takos-tools/follows.ts";
import {
  handleGetDmMessages,
  handleGetDmThreads,
  handleSendDm,
} from "./takos-tools/dm.ts";
import {
  handleGetNotifications,
  handleGetTimeline,
} from "./takos-tools/timeline.ts";

type HonoEnv = { Bindings: Env; Variables: Variables };

const takosTools = new Hono<HonoEnv>();
const log = logger.child({ component: "takos.tools" });

// Feature flag gate (fail-close).
takosTools.use("*", async (c, next) => {
  if (c.env.ENABLE_TAKOS_TOOLS !== "true") {
    return c.notFound();
  }
  await next();
});

interface ToolRequest {
  input: Record<string, unknown>;
  context?: {
    user_id?: string;
    session_id?: string;
  };
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

takosTools.post("/:name", async (c) => {
  const toolName = c.req.param("name");
  const actor = c.get("actor");

  let body: ToolRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { success: false, error: "Invalid JSON body" } as ToolResponse,
      400,
    );
  }

  const input = body.input || {};

  try {
    switch (toolName) {
      // ------ Search tools ------
      case "yurucommu_search_users":
        return await handleSearchUsers(c, input, actor);
      case "yurucommu_search_posts":
        return await handleSearchPosts(c, input, actor);
      case "yurucommu_get_trending":
        return await handleGetTrending(c, input, actor);
      case "yurucommu_get_user_profile":
        return await handleGetUserProfile(c, input, actor);

      // ------ Post tools ------
      case "yurucommu_create_post":
        return await handleCreatePost(c, input, actor);
      case "yurucommu_delete_post":
        return await handleDeletePost(c, input, actor);
      case "yurucommu_like_post":
        return await handleLikePost(c, input, actor);
      case "yurucommu_bookmark_post":
        return await handleBookmarkPost(c, input, actor);

      // ------ Follow tools ------
      case "yurucommu_follow_user":
        return await handleFollowUser(c, input, actor);
      case "yurucommu_unfollow_user":
        return await handleUnfollowUser(c, input, actor);
      case "yurucommu_get_followers":
        return await handleGetFollowList(c, input, actor, "followers");
      case "yurucommu_get_following":
        return await handleGetFollowList(c, input, actor, "following");

      // ------ DM tools ------
      case "yurucommu_send_dm":
        return await handleSendDm(c, input, actor);
      case "yurucommu_get_dm_threads":
        return await handleGetDmThreads(c, input, actor);
      case "yurucommu_get_dm_messages":
        return await handleGetDmMessages(c, input, actor);

      // ------ Timeline tools ------
      case "yurucommu_get_timeline":
        return await handleGetTimeline(c, input, actor);
      case "yurucommu_get_notifications":
        return await handleGetNotifications(c, input, actor);

      default:
        return c.json(
          { success: false, error: `Unknown tool: ${toolName}` },
          404,
        );
    }
  } catch (error) {
    log.error("Takos tool failed", {
      event: "takos.tools.failed",
      toolName,
      error,
    });
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Internal error",
      } as ToolResponse,
      500,
    );
  }
});

export default takosTools;
