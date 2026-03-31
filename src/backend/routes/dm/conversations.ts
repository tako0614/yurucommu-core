// Direct Messages - AP Native
// DMs are Note objects with visibility='direct' and to=[recipient]
// Threading via conversation field
//
// Router entry: composes sub-modules and defines the small conversation CRUD routes.

import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { actors, actorCache } from '../../../db/index.ts';
import { getConversationId } from './query-helpers.ts';
import {
  type HonoEnv,
  ACTOR_INFO_FIELDS,
  ACTOR_CACHE_INFO_FIELDS,
  formatActorProfile,
} from './conversations-helpers.ts';

import contacts from './contacts.ts';
import requests from './requests.ts';
import typing from './typing.ts';
import readArchive from './read-archive.ts';

// -- Routes --

const dm = new Hono<HonoEnv>();

// Mount sub-routers
dm.route('/', contacts);
dm.route('/', requests);
dm.route('/', typing);
dm.route('/', readArchive);

// -- Conversation CRUD (small) --

dm.get('/conversations', async (c) => {
  return c.redirect('/api/dm/contacts');
});

dm.post('/conversations', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);
  const db = c.get('db');

  const body = await c.req.json<{ participant_ap_id: string }>();
  if (!body.participant_ap_id) {
    return c.json({ error: 'participant_ap_id is required' }, 400);
  }

  const baseUrl = c.env.APP_URL;
  const conversationId = getConversationId(baseUrl, actor.ap_id, body.participant_ap_id);

  const localActor = await db.select(ACTOR_INFO_FIELDS)
    .from(actors)
    .where(eq(actors.apId, body.participant_ap_id))
    .get();

  const cachedActor = localActor ? null : await db.select(ACTOR_CACHE_INFO_FIELDS)
    .from(actorCache)
    .where(eq(actorCache.apId, body.participant_ap_id))
    .get();

  const otherInfo = localActor || cachedActor;
  if (!otherInfo) {
    return c.json({ error: 'Actor not found' }, 404);
  }

  return c.json({
    conversation: {
      id: conversationId,
      other_participant: formatActorProfile(body.participant_ap_id, otherInfo),
      last_message_at: null,
      created_at: new Date().toISOString(),
    },
  });
});

export default dm;
