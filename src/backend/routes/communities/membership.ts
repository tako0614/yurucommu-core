import { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { registerMembershipInviteRoutes } from './membership-invites';
import { registerMembershipJoinRoutes } from './membership-join';
import { registerMembershipMemberRoutes } from './membership-members';
import { registerMembershipRequestRoutes } from './membership-requests';

const communities = new Hono<{ Bindings: Env; Variables: Variables }>();

registerMembershipJoinRoutes(communities);
registerMembershipRequestRoutes(communities);
registerMembershipInviteRoutes(communities);
registerMembershipMemberRoutes(communities);

export default communities;
