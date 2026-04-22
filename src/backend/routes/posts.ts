// Posts, Likes, and Bookmarks routes for Yurucommu backend
import { Hono } from "hono";
import type { Env, Variables } from "../types.ts";
import baseRoutes from "./posts/routes.ts";
import interactionRoutes from "./posts/interactions.ts";

const posts = new Hono<{ Bindings: Env; Variables: Variables }>();

posts.route("/", baseRoutes);
posts.route("/", interactionRoutes);

export default posts;
