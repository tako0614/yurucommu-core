import type { Env } from '../../types';
import { generateKeyPair, parseLimit } from '../../utils';

export const INSTANCE_ACTOR_USERNAME = 'community';
export const MAX_ROOM_STREAM_LIMIT = 50;

export { parseLimit };

export function roomApId(baseUrl: string, roomId: string): string {
  return `${baseUrl}/ap/rooms/${roomId}`;
}

type InstanceActorRow = {
  ap_id: string;
  preferred_username: string;
  name: string;
  summary: string;
  public_key_pem: string;
  private_key_pem: string;
  join_policy: string;
  posting_policy: string;
  visibility: string;
};

export async function getInstanceActor(c: { env: Env }): Promise<InstanceActorRow> {
  const baseUrl = c.env.APP_URL;
  const apId = `${baseUrl}/ap/actor`;
  let actor = await c.env.DB.prepare(
    `SELECT ap_id, preferred_username, name, summary, public_key_pem, private_key_pem, join_policy, posting_policy, visibility
     FROM instance_actor WHERE ap_id = ?`
  )
    .bind(apId)
    .first<InstanceActorRow>();

  if (!actor) {
    const { publicKeyPem, privateKeyPem } = await generateKeyPair();
    const now = new Date().toISOString();
    await c.env.DB.prepare(`
      INSERT INTO instance_actor (ap_id, preferred_username, name, summary, public_key_pem, private_key_pem, join_policy, posting_policy, visibility, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'open', 'members', 'public', ?, ?)
    `)
      .bind(
        apId,
        INSTANCE_ACTOR_USERNAME,
        'Yurucommu',
        'Yurucommu Community',
        publicKeyPem,
        privateKeyPem,
        now,
        now
      )
      .run();

    actor = {
      ap_id: apId,
      preferred_username: INSTANCE_ACTOR_USERNAME,
      name: 'Yurucommu',
      summary: 'Yurucommu Community',
      public_key_pem: publicKeyPem,
      private_key_pem: privateKeyPem,
      join_policy: 'open',
      posting_policy: 'members',
      visibility: 'public',
    };
  }

  return actor;
}
