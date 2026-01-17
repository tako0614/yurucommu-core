// Posts, Likes, and Bookmarks routes for Yurucommu backend
import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import baseRoutes from './posts/base';
import interactionRoutes from './posts/interactions';

const posts = new Hono<{ Bindings: Env; Variables: Variables }>();

posts.route('/', baseRoutes);
posts.route('/', interactionRoutes);

export default posts;
