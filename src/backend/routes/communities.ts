import { Hono } from "hono";
import type { Env, Variables } from "../types.ts";
import baseRoutes from "./communities/routes.ts";
import { registerMembershipInviteRoutes } from "./communities/membership-invites.ts";
import { registerMembershipJoinRoutes } from "./communities/membership-join.ts";
import { registerMembershipMemberRoutes } from "./communities/membership-members.ts";
import { registerMembershipRequestRoutes } from "./communities/membership-requests.ts";
import messageRoutes from "./communities/messages.ts";

const communities = new Hono<{ Bindings: Env; Variables: Variables }>();

communities.route("/", baseRoutes);

registerMembershipJoinRoutes(communities);
registerMembershipRequestRoutes(communities);
registerMembershipInviteRoutes(communities);
registerMembershipMemberRoutes(communities);

communities.route("/", messageRoutes);

export default communities;
