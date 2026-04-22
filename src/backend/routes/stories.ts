// Story routes for Yurucommu backend
// v2: 1 Story = 1 Media (Instagram style)
import { Hono } from "hono";
import type { Env, Variables } from "../types.ts";
import baseRoutes from "./stories/routes.ts";
import interactionRoutes from "./stories/interactions.ts";

const stories = new Hono<{ Bindings: Env; Variables: Variables }>();

stories.route("/", baseRoutes);
stories.route("/", interactionRoutes);

export default stories;
