import type { Context } from 'hono';
import type { Env, Variables } from '../../types';
import { generateKeyPair, parseLimit } from '../../utils';

export const INSTANCE_ACTOR_USERNAME = 'community';
export const MAX_ROOM_STREAM_LIMIT = 50;

export { parseLimit };

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
  const prisma = c.get('prisma');
  const baseUrl = c.env.APP_URL;
  const apId = `${baseUrl}/ap/actor`;

  let actor = await prisma.instanceActor.findUnique({
    where: { apId },
  });

  if (!actor) {
    const { publicKeyPem, privateKeyPem } = await generateKeyPair();
    const now = new Date().toISOString();
    actor = await prisma.instanceActor.create({
      data: {
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
      },
    });
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
