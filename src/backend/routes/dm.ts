// Direct Messages - AP Native
// DMs are Note objects with visibility='direct' and to=[recipient]
// Threading via conversation field

import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import conversationRoutes from './dm/conversations';
import messageRoutes from './dm/messages';

const dm = new Hono<{ Bindings: Env; Variables: Variables }>();

dm.route('/', conversationRoutes);
dm.route('/', messageRoutes);

export default dm;
