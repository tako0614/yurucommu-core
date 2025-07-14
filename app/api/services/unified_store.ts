import ObjectStore, { objectStoreSchema } from "../models/object_store.ts";
import FollowEdge from "../models/follow_edge.ts";
import { createObjectId } from "../utils/activitypub.ts";
import RelayEdge from "../models/relay_edge.ts";
import type { InferSchemaType, PipelineStage, SortOrder } from "mongoose";

type ObjectStoreType = InferSchemaType<typeof objectStoreSchema>;

export async function saveNote(
  env: Record<string, string>,
  domain: string,
  author: string,
  content: string,
  extra: Record<string, unknown>,
  aud = {
    to: ["https://www.w3.org/ns/activitystreams#Public"],
    cc: [] as string[],
  },
) {
  const id = createObjectId(domain);
  const actor = `https://${domain}/users/${author}`;
  const raw = {
    "@context": "https://www.w3.org/ns/activitystreams",
    id,
    type: "Note",
    content,
    published: new Date().toISOString(),
    attributedTo: actor,
    ...extra,
  };
  const doc = new ObjectStore({
    _id: id,
    raw,
    type: "Note",
    actor_id: actor,
    aud,
  });
  (doc as unknown as { $locals?: { env?: Record<string, string> } }).$locals = {
    env,
  };
  await doc.save();
  return doc;
}

export async function saveObject(
  env: Record<string, string>,
  data: Record<string, unknown>,
) {
  if (!data._id && env["ACTIVITYPUB_DOMAIN"]) {
    data._id = createObjectId(env["ACTIVITYPUB_DOMAIN"]);
  }
  const doc = new ObjectStore(data);
  (doc as unknown as { $locals?: { env?: Record<string, string> } }).$locals = {
    env,
  };
  await doc.save();
  return doc;
}

export async function updateObject(
  id: string,
  update: Record<string, unknown>,
) {
  return await ObjectStore.findByIdAndUpdate(id, update, { new: true });
}

export async function deleteObject(id: string) {
  return await ObjectStore.findByIdAndDelete(id);
}

export async function deleteManyObjects(filter: Record<string, unknown>) {
  return await ObjectStore.deleteMany(filter);
}

export async function findObjects(
  filter: Record<string, unknown>,
  sort?: Record<string, SortOrder>,
): Promise<ObjectStoreType[]> {
  return await ObjectStore.find(filter).sort(sort ?? {}).lean<
    ObjectStoreType[]
  >();
}

export async function getPublicNotes(limit = 40, before?: Date): Promise<
  ObjectStoreType[]
> {
  const query = ObjectStore.find({
    type: "Note",
    "aud.to": "https://www.w3.org/ns/activitystreams#Public",
  });
  if (before) query.where("created_at").lt(before.getTime());
  return await query.sort({ created_at: -1 }).limit(limit).lean<
    ObjectStoreType[]
  >();
}

export async function getTimeline(
  tenantId: string,
  actorUri: string,
  limit = 40,
  before?: Date,
): Promise<ObjectStoreType[]> {
  const pipeline: PipelineStage[] = [
    { $match: { tenant_id: tenantId } },
    {
      $lookup: {
        from: "object_store",
        localField: "actor_id",
        foreignField: "actor_id",
        as: "objs",
      },
    },
    { $unwind: "$objs" },
    {
      $match: {
        $or: [
          { "objs.aud.to": actorUri },
          { "objs.aud.cc": actorUri },
          { "objs.aud.to": "https://www.w3.org/ns/activitystreams#Public" },
        ],
      },
    },
  ];
  if (before) {
    pipeline.push({ $match: { "objs.created_at": { $lt: before } } });
  }
  pipeline.push({ $sort: { "objs.created_at": -1 } }, { $limit: limit });
  const docs = await FollowEdge.aggregate(pipeline).exec();
  return docs.map((d) => d.objs as ObjectStoreType);
}

export async function getObject(id: string): Promise<ObjectStoreType | null> {
  return await ObjectStore.findById(id).lean<ObjectStoreType | null>();
}

export async function addFollowEdge(tenantId: string, actorId: string) {
  await FollowEdge.updateOne(
    { tenant_id: tenantId, actor_id: actorId },
    { $setOnInsert: { since: new Date() } },
    { upsert: true },
  );
}

export async function removeFollowEdge(tenantId: string, actorId: string) {
  await FollowEdge.deleteOne({ tenant_id: tenantId, actor_id: actorId });
}

export async function addRelayEdge(
  tenantId: string,
  relay: string,
  mode: "pull" | "push" = "pull",
) {
  await RelayEdge.updateOne(
    { tenant_id: tenantId, relay, mode },
    { $setOnInsert: { since: new Date() } },
    { upsert: true },
  );
}

export async function removeRelayEdge(tenantId: string, relay: string) {
  await RelayEdge.deleteOne({ tenant_id: tenantId, relay });
}

export async function listPullRelays(tenantId: string) {
  const docs = await RelayEdge.find({ tenant_id: tenantId, mode: "pull" }).lean<
    { relay: string }[]
  >();
  return docs.map((d) => d.relay);
}

export async function listPushRelays(tenantId: string) {
  const docs = await RelayEdge.find({ tenant_id: tenantId, mode: "push" }).lean<
    { relay: string }[]
  >();
  return docs.map((d) => d.relay);
}
