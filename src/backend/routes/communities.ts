import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import baseRoutes from './communities/routes';
import { registerMembershipInviteRoutes } from './communities/membership-invites';
import { registerMembershipJoinRoutes } from './communities/membership-join';
import { registerMembershipMemberRoutes } from './communities/membership-members';
import { registerMembershipRequestRoutes } from './communities/membership-requests';
import messageRoutes from './communities/messages';

const communities = new Hono<{ Bindings: Env; Variables: Variables }>();

communities.route('/', baseRoutes);

registerMembershipJoinRoutes(communities);
registerMembershipRequestRoutes(communities);
registerMembershipInviteRoutes(communities);
registerMembershipMemberRoutes(communities);

communities.route('/', messageRoutes);

export default communities;
