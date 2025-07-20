import ObjectStore, { objectStoreSchema } from "../models/object_store.ts";
import Note, { noteSchema } from "../models/note.ts";
import Video, { videoSchema } from "../models/video.ts";
import Message, { messageSchema } from "../models/message.ts";
import FollowEdge from "../models/follow_edge.ts";
import { createObjectId } from "../utils/activitypub.ts";
import RelayEdge from "../models/relay_edge.ts";
import type { InferSchemaType, PipelineStage, SortOrder } from "mongoose";

function tenantId(env: Record<string, string>): string | undefined {
  return env["DB_MODE"] === "host" ? env["ACTIVITYPUB_DOMAIN"] : undefined;
}

function withTenant(
  filter: Record<string, unknown>,
  env: Record<string, string>,
): Record<string, unknown> {
  const t = tenantId(env);
  return t ? { ...filter, tenant_id: t } : filter;
}

type ObjectStoreType = InferSchemaType<typeof objectStoreSchema>;
type NoteType = InferSchemaType<typeof noteSchema>;
type VideoType = InferSchemaType<typeof videoSchema>;
type MessageType = InferSchemaType<typeof messageSchema>;
export type ActivityObject =
  | NoteType
  | VideoType
  | MessageType
  | ObjectStoreType;

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
  const doc = new Note({
    _id: id,
    attributedTo: author,
    actor_id: actor,
    content,
    extra,
    ...(tenantId(env) ? { tenant_id: tenantId(env) } : {}),
    published: new Date(),
    aud,
  });
  (doc as unknown as { $locals?: { env?: Record<string, string> } }).$locals = {
    env,
  };
  await doc.save();
  return doc;
}

export async function saveVideo(
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
  const doc = new Video({
    _id: id,
    attributedTo: author,
    actor_id: actor,
    content,
    extra,
    ...(tenantId(env) ? { tenant_id: tenantId(env) } : {}),
    published: new Date(),
    aud,
  });
  (doc as unknown as { $locals?: { env?: Record<string, string> } }).$locals = {
    env,
  };
  await doc.save();
  return doc;
}

export async function saveMessage(
  env: Record<string, string>,
  domain: string,
  author: string,
  content: string,
  extra: Record<string, unknown>,
  aud: { to: string[]; cc: string[] },
) {
  const id = createObjectId(domain);
  const actor = `https://${domain}/users/${author}`;
  const doc = new Message({
    _id: id,
    attributedTo: author,
    actor_id: actor,
    content,
    extra,
    ...(tenantId(env) ? { tenant_id: tenantId(env) } : {}),
    published: new Date(),
    aud,
  });
  (doc as unknown as { $locals?: { env?: Record<string, string> } }).$locals = {
    env,
  };
  await doc.save();
  return doc;
}

export async function updateNote(
  env: Record<string, string>,
  id: string,
  update: Record<string, unknown>,
) {
  return await Note.findOneAndUpdate(
    withTenant({ _id: id }, env),
    update,
    { new: true },
  );
}

export async function updateVideo(
  env: Record<string, string>,
  id: string,
  update: Record<string, unknown>,
) {
  return await Video.findOneAndUpdate(
    withTenant({ _id: id }, env),
    update,
    { new: true },
  );
}

export async function updateMessage(
  env: Record<string, string>,
  id: string,
  update: Record<string, unknown>,
) {
  return await Message.findOneAndUpdate(
    withTenant({ _id: id }, env),
    update,
    { new: true },
  );
}

export async function deleteNote(env: Record<string, string>, id: string) {
  return await Note.findOneAndDelete(withTenant({ _id: id }, env));
}

export async function deleteVideo(env: Record<string, string>, id: string) {
  return await Video.findOneAndDelete(withTenant({ _id: id }, env));
}

export async function deleteMessage(env: Record<string, string>, id: string) {
  return await Message.findOneAndDelete(withTenant({ _id: id }, env));
}

export async function findNotes(
  env: Record<string, string>,
  filter: Record<string, unknown>,
  sort?: Record<string, SortOrder>,
) {
  const f = withTenant({ ...filter }, env);
  return await Note.find(f).sort(sort ?? {}).lean<NoteType[]>();
}

export async function findVideos(
  env: Record<string, string>,
  filter: Record<string, unknown>,
  sort?: Record<string, SortOrder>,
) {
  const f = withTenant({ ...filter }, env);
  return await Video.find(f).sort(sort ?? {}).lean<VideoType[]>();
}

export async function findMessages(
  env: Record<string, string>,
  filter: Record<string, unknown>,
  sort?: Record<string, SortOrder>,
) {
  const f = withTenant({ ...filter }, env);
  return await Message.find(f).sort(sort ?? {}).lean<MessageType[]>();
}

export async function saveObject(
  env: Record<string, string>,
  data: Record<string, unknown>,
) {
  if (!data._id && env["ACTIVITYPUB_DOMAIN"]) {
    data._id = createObjectId(env["ACTIVITYPUB_DOMAIN"]);
  }
  const t = tenantId(env);
  if (!("tenant_id" in data) && t) {
    data.tenant_id = t;
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
  return await ObjectStore.findOneAndUpdate(
    withTenant({ _id: id }, env),
    update,
    { new: true },
  );
}

export async function deleteObject(env: Record<string, string>, id: string) {
  return await ObjectStore.findOneAndDelete(withTenant({ _id: id }, env));
}

export async function deleteManyObjects(
  env: Record<string, string>,
  filter: Record<string, unknown>,
) {
  return await ObjectStore.deleteMany(withTenant({ ...filter }, env));
}

export async function findObjects(
  env: Record<string, string>,
  filter: Record<string, unknown>,
  sort?: Record<string, SortOrder>,
): Promise<ObjectStoreType[]> {
  const f = withTenant({ ...filter }, env);
  return await ObjectStore.find(f).sort(sort ?? {}).lean<
    ObjectStoreType[]
  >();
}

export async function getPublicNotes(
  env: Record<string, string>,
  limit = 40,
  before?: Date,
): Promise<ActivityObject[]> {
  const query = Note.find({
    "aud.to": "https://www.w3.org/ns/activitystreams#Public",
  });
  const objQuery = ObjectStore.find({
    type: "Note",
    "aud.to": "https://www.w3.org/ns/activitystreams#Public",
  });
  const t = tenantId(env);
  if (t) {
    query.where("tenant_id").equals(t);
    objQuery.where("tenant_id").equals(t);
  }
  if (before) {
    query.where("created_at").lt(before.getTime());
    objQuery.where("created_at").lt(before.getTime());
  }
  const [notes, objs] = await Promise.all([
    query.sort({ created_at: -1 }).limit(limit).lean<NoteType[]>(),
    objQuery.sort({ created_at: -1 }).limit(limit).lean<ObjectStoreType[]>(),
  ]);
  const merged = [
    ...notes,
    ...objs,
  ] as ActivityObject[];
  merged.sort((a, b) => {
    const at = (a.created_at ?? a.published ?? 0) as Date;
    const bt = (b.created_at ?? b.published ?? 0) as Date;
    return bt.getTime() - at.getTime();
  });
  return merged.slice(0, limit);
}

export async function getTimeline(
  tenantId: string | undefined,
  actorUri: string,
  limit = 40,
  before?: Date,
): Promise<NoteType[]> {
  const pipeline: PipelineStage[] = [];
  if (tenantId) pipeline.push({ $match: { tenant_id: tenantId } });
  pipeline.push(
    {
      $lookup: {
        from: "notes",
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
  );
  if (before) {
    pipeline.push({ $match: { "objs.created_at": { $lt: before } } });
  }
  pipeline.push({ $sort: { "objs.created_at": -1 } }, { $limit: limit });
  const docs = await FollowEdge.aggregate(pipeline).exec();
  return docs.map((d) => d.objs as NoteType);
}

export async function getObject(
  env: Record<string, string>,
  id: string,
): Promise<ActivityObject | null> {
  let doc = await Note.findOne(withTenant({ _id: id }, env)).lean<
    NoteType | null
  >();
  if (doc) return doc;
  doc = await Video.findOne(withTenant({ _id: id }, env)).lean<
    VideoType | null
  >();
  if (doc) return doc;
  doc = await Message.findOne(withTenant({ _id: id }, env)).lean<
    MessageType | null
  >();
  if (doc) return doc;
  return await ObjectStore.findOne(withTenant({ _id: id }, env)).lean<
    ObjectStoreType | null
  >();
}

export async function addFollowEdge(tenantId: string, actorId: string) {
  const filter: Record<string, unknown> = { actor_id: actorId };
  if (tenantId) filter.tenant_id = tenantId;
  await FollowEdge.updateOne(
    filter,
    { $setOnInsert: { since: new Date() } },
    { upsert: true },
  );
}

export async function removeFollowEdge(tenantId: string, actorId: string) {
  const filter: Record<string, unknown> = { actor_id: actorId };
  if (tenantId) filter.tenant_id = tenantId;
  await FollowEdge.deleteOne(filter);
}

export async function addRelayEdge(
  tenantId: string,
  relay: string,
  mode: "pull" | "push" = "pull",
) {
  const filter: Record<string, unknown> = { relay, mode };
  if (tenantId) filter.tenant_id = tenantId;
  await RelayEdge.updateOne(
    filter,
    { $setOnInsert: { since: new Date() } },
    { upsert: true },
  );
}

export async function removeRelayEdge(tenantId: string, relay: string) {
  const filter: Record<string, unknown> = { relay };
  if (tenantId) filter.tenant_id = tenantId;
  await RelayEdge.deleteOne(filter);
}

export async function listPullRelays(tenantId: string) {
  const cond: Record<string, unknown> = { mode: "pull" };
  if (tenantId) cond.tenant_id = tenantId;
  const docs = await RelayEdge.find(cond).lean<
    { relay: string }[]
  >();
  return docs.map((d) => d.relay);
}

export async function listPushRelays(tenantId: string) {
  const cond: Record<string, unknown> = { mode: "push" };
  if (tenantId) cond.tenant_id = tenantId;
  const docs = await RelayEdge.find(cond).lean<
    { relay: string }[]
  >();
  return docs.map((d) => d.relay);
}
