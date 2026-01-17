import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import baseRoutes from './communities/base';
import membershipRoutes from './communities/membership';
import messageRoutes from './communities/messages';

const communities = new Hono<{ Bindings: Env; Variables: Variables }>();

communities.route('/', baseRoutes);
communities.route('/', membershipRoutes);
communities.route('/', messageRoutes);

export default communities;
