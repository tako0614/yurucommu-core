export interface RemoteActorData {
  actorUrl: string;
  name: string;
  preferredUsername: string;
  icon: unknown;
  summary: string;
}

import RemoteActor from "../models/remote_actor.ts";

export async function findRemoteActorByUrl(
  url: string,
): Promise<RemoteActorData | null> {
  return await RemoteActor.findOne({ actorUrl: url }).lean<
    RemoteActorData | null
  >();
}

export async function findRemoteActorsByUrls(
  urls: string[],
): Promise<RemoteActorData[]> {
  return await RemoteActor.find({ actorUrl: { $in: urls } }).lean<
    RemoteActorData[]
  >();
}

export async function upsertRemoteActor(data: RemoteActorData) {
  await RemoteActor.findOneAndUpdate(
    { actorUrl: data.actorUrl },
    {
      name: data.name,
      preferredUsername: data.preferredUsername,
      icon: data.icon,
      summary: data.summary,
      cachedAt: new Date(),
    },
    { upsert: true },
  );
}
