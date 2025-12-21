import type { LocalUser, Actor } from '../../types';

const ACTIVITY_STREAMS_CONTEXT = [
  'https://www.w3.org/ns/activitystreams',
  'https://w3id.org/security/v1',
];

export function buildActor(user: LocalUser, hostname: string): Actor {
  const actorUrl = `https://${hostname}/users/${user.username}`;

  const actor: Actor = {
    '@context': ACTIVITY_STREAMS_CONTEXT,
    id: actorUrl,
    type: 'Person',
    preferredUsername: user.username,
    name: user.display_name,
    summary: user.summary,
    inbox: `${actorUrl}/inbox`,
    outbox: `${actorUrl}/outbox`,
    followers: `${actorUrl}/followers`,
    following: `${actorUrl}/following`,
    publicKey: {
      id: `${actorUrl}#main-key`,
      owner: actorUrl,
      publicKeyPem: user.public_key,
    },
  };

  if (user.avatar_url) {
    actor.icon = {
      type: 'Image',
      mediaType: 'image/png',
      url: user.avatar_url,
    };
  }

  if (user.header_url) {
    actor.image = {
      type: 'Image',
      mediaType: 'image/png',
      url: user.header_url,
    };
  }

  return actor;
}

export function buildWebFinger(user: LocalUser, hostname: string): object {
  const actorUrl = `https://${hostname}/users/${user.username}`;

  return {
    subject: `acct:${user.username}@${hostname}`,
    aliases: [actorUrl],
    links: [
      {
        rel: 'self',
        type: 'application/activity+json',
        href: actorUrl,
      },
      {
        rel: 'http://webfinger.net/rel/profile-page',
        type: 'text/html',
        href: `https://${hostname}/@${user.username}`,
      },
    ],
  };
}
