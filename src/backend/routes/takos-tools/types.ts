/**
 * Shared types for takos-tools handler modules.
 */

import type { Context } from 'hono';
import type { Env, Variables } from '../../types';

export type HonoEnv = { Bindings: Env; Variables: Variables };
export type ToolContext = Context<HonoEnv>;
export type Input = Record<string, unknown>;
