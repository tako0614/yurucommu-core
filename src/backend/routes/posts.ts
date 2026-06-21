// Posts, Likes, and Bookmarks routes for Yurucommu backend
import { Hono } from "hono";
import type { Env, Variables } from "../types.ts";
import baseRoutes from "./posts/routes.ts";
import interactionRoutes from "./posts/interactions.ts";

const posts = new Hono<{ Bindings: Env; Variables: Variables }>();

// Interaction routes FIRST: its only GET is the static `/bookmarks`, which would
// otherwise be shadowed by baseRoutes' `GET /:id` (matching id="bookmarks" → a
// 404 "post not found"). interactionRoutes never shadows a base route — its
// other routes are POST/DELETE `/:id/{like,repost,bookmark}` (two-segment), so a
// non-matching request falls through to baseRoutes' `/:id` / `/` / `/:id/replies`.
posts.route("/", interactionRoutes);
posts.route("/", baseRoutes);

export default posts;
