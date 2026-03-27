import type { Context } from 'hono';
import type { Env, Variables } from '../../types';
import { eq } from 'drizzle-orm';
import { instanceActor } from '../../../db';
import { generateKeyPair } from '../../federation-helpers';

export const INSTANCE_ACTOR_USERNAME = 'community';
export const MAX_ROOM_STREAM_LIMIT = 50;

export function roomApId(baseUrl: string, roomId: string): string {
  return `${baseUrl}/ap/rooms/${roomId}`;
}

export type InstanceActorResult = {
  apId: string;
  preferredUsername: string;
  name: string | null;
  summary: string | null;
  publicKeyPem: string;
  privateKeyPem: string;
  joinPolicy: string;
  postingPolicy: string;
  visibility: string;
};

export async function getInstanceActor(c: Context<{ Bindings: Env; Variables: Variables }>): Promise<InstanceActorResult> {
  const db = c.get('db');
  const baseUrl = c.env.APP_URL;
  const apId = `${baseUrl}/ap/actor`;

  let actor = await db.query.instanceActor.findFirst({
    where: eq(instanceActor.apId, apId),
  });

  if (!actor) {
    const { publicKeyPem, privateKeyPem } = await generateKeyPair();
    const now = new Date().toISOString();
    actor = await db.insert(instanceActor).values({
      apId,
      preferredUsername: INSTANCE_ACTOR_USERNAME,
      name: 'Yurucommu',
      summary: 'Yurucommu Community',
      publicKeyPem,
      privateKeyPem,
      joinPolicy: 'open',
      postingPolicy: 'members',
      visibility: 'public',
      createdAt: now,
      updatedAt: now,
    }).returning().get();
  }

  return {
    apId: actor.apId,
    preferredUsername: actor.preferredUsername,
    name: actor.name,
    summary: actor.summary,
    publicKeyPem: actor.publicKeyPem,
    privateKeyPem: actor.privateKeyPem,
    joinPolicy: actor.joinPolicy,
    postingPolicy: actor.postingPolicy,
    visibility: actor.visibility,
  };
}
