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
    tenant_id: env["ACTIVITYPUB_DOMAIN"],
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
  if (!("tenant_id" in data) && env["ACTIVITYPUB_DOMAIN"]) {
    data.tenant_id = env["ACTIVITYPUB_DOMAIN"];
  }
  const doc = new ObjectStore(data);
  (doc as unknown as { $locals?: { env?: Record<string, string> } }).$locals = {
    env,
  };
  await doc.save();
  return doc;
}

export async function updateObject(
  env: Record<string, string>,
  id: string,
  update: Record<string, unknown>,
) {
  const tenantId = env["ACTIVITYPUB_DOMAIN"];
  return await ObjectStore.findOneAndUpdate(
    { _id: id, tenant_id: tenantId },
    update,
    { new: true },
  );
}

export async function deleteObject(env: Record<string, string>, id: string) {
  const tenantId = env["ACTIVITYPUB_DOMAIN"];
  return await ObjectStore.findOneAndDelete({ _id: id, tenant_id: tenantId });
}

export async function deleteManyObjects(
  env: Record<string, string>,
  filter: Record<string, unknown>,
) {
  const tenantId = env["ACTIVITYPUB_DOMAIN"];
  return await ObjectStore.deleteMany({ ...filter, tenant_id: tenantId });
}

export async function findObjects(
  env: Record<string, string>,
  filter: Record<string, unknown>,
  sort?: Record<string, SortOrder>,
): Promise<ObjectStoreType[]> {
  const tenantId = env["ACTIVITYPUB_DOMAIN"];
  const f = { ...filter } as Record<string, unknown>;
  if (tenantId) f.tenant_id = tenantId;
  return await ObjectStore.find(f).sort(sort ?? {}).lean<
    ObjectStoreType[]
  >();
}

export async function getPublicNotes(
  env: Record<string, string>,
  limit = 40,
  before?: Date,
): Promise<
  ObjectStoreType[]
> {
  const query = ObjectStore.find({
    type: "Note",
    "aud.to": "https://www.w3.org/ns/activitystreams#Public",
  });
  const tenantId = env["ACTIVITYPUB_DOMAIN"];
  if (tenantId) query.where("tenant_id").equals(tenantId);
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

export async function getObject(
  env: Record<string, string>,
  id: string,
): Promise<ObjectStoreType | null> {
  const tenantId = env["ACTIVITYPUB_DOMAIN"];
  return await ObjectStore.findOne({ _id: id, tenant_id: tenantId }).lean<
    ObjectStoreType | null
  >();
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
