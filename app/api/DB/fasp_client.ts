import FaspClientProvider from "../models/takos/fasp_client_provider.ts";
import FaspClientSetting from "../models/takos/fasp_client_setting.ts";
import FaspClientEventSubscription from "../models/takos/fasp_client_event_subscription.ts";
import FaspClientBackfill from "../models/takos/fasp_client_backfill.ts";

export async function listProviders(env: Record<string, string>) {
  const q = FaspClientProvider.find({}).setOptions({ $locals: { env } });
  const docs = await q.sort({ status: 1, updatedAt: -1 }).lean();
  return docs;
}

export async function consolidateBaseUrl(
  env: Record<string, string>,
  variants: string[],
  baseUrl: string,
) {
  await FaspClientProvider.updateMany(
    { baseUrl: { $in: variants } },
    { $set: { baseUrl, updatedAt: new Date() } },
  ).setOptions({ $locals: { env } });
}

export async function upsertProviderOnDiscover(env: Record<string, string>, data: {
  baseUrl: string;
  name: string;
  capabilities: Record<string, { version: string; enabled: boolean }>;
  status: "approved" | "pending";
  approvedAt: Date | null;
  serverId: string;
  faspId: string;
}) {
  const now = new Date();
  const res = await FaspClientProvider.findOneAndUpdate(
    { baseUrl: data.baseUrl },
    {
      $setOnInsert: {
        faspId: data.faspId,
        serverId: data.serverId,
        createdAt: now,
      },
      $set: {
        name: data.name,
        baseUrl: data.baseUrl,
        capabilities: data.capabilities,
        status: data.status,
        approvedAt: data.approvedAt,
        rejectedAt: null,
        updatedAt: now,
      },
    },
    { upsert: true, new: true },
  ).setOptions({ $locals: { env } });
  return res?.toObject() ?? null;
}

export async function ensureSecret(env: Record<string, string>, baseUrl: string): Promise<string> {
  const doc = await FaspClientProvider.findOne({ baseUrl }).setOptions({ $locals: { env } });
  if (doc?.secret) return doc.secret;
  const secret = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  await FaspClientProvider.updateOne({ baseUrl }, { $set: { secret, updatedAt: new Date() } })
    .setOptions({ $locals: { env } });
  return secret;
}

export async function findProviderByServerId(env: Record<string, string>, serverId: string) {
  return await FaspClientProvider.findOne({ serverId }).setOptions({ $locals: { env } }).lean();
}

export async function approveProvider(env: Record<string, string>, serverId: string) {
  const res = await FaspClientProvider.findOneAndUpdate(
    { serverId },
    { $set: { status: "approved", approvedAt: new Date(), rejectedAt: null } },
    { new: true },
  ).setOptions({ $locals: { env } });
  return !!res;
}

export async function rejectProvider(env: Record<string, string>, serverId: string) {
  const res = await FaspClientProvider.findOneAndUpdate(
    { serverId },
    { $set: { status: "rejected", rejectedAt: new Date() } },
    { new: true },
  ).setOptions({ $locals: { env } });
  return !!res;
}

export async function deleteProvider(env: Record<string, string>, serverId: string) {
  const r = await FaspClientProvider.deleteOne({ serverId }).setOptions({ $locals: { env } });
  return r.deletedCount > 0;
}

export async function updateCapabilities(
  env: Record<string, string>,
  serverId: string,
  capabilities: Record<string, { version: string; enabled: boolean }>,
) {
  const res = await FaspClientProvider.findOneAndUpdate(
    { serverId },
    { $set: { capabilities, updatedAt: new Date() } },
    { new: true },
  ).setOptions({ $locals: { env } });
  return res?.toObject() ?? null;
}

export async function getSettings(env: Record<string, string>) {
  const doc = await FaspClientSetting.findOne({ _id: "default" }).setOptions({ $locals: { env } }).lean();
  return doc ?? null;
}

export async function putSettings(env: Record<string, string>, update: Record<string, unknown>) {
  await FaspClientSetting.updateOne(
    { _id: "default" },
    { $set: { ...update, updatedAt: new Date() }, $setOnInsert: { _id: "default", createdAt: new Date() } },
    { upsert: true },
  ).setOptions({ $locals: { env } });
}

export async function insertEventSubscription(env: Record<string, string>, id: string, payload: unknown) {
  const doc = new FaspClientEventSubscription({ _id: id, payload });
  (doc as unknown as { $locals?: { env?: Record<string, string> } }).$locals = { env };
  await doc.save();
}

export async function deleteEventSubscription(env: Record<string, string>, id: string) {
  await FaspClientEventSubscription.deleteOne({ _id: id }).setOptions({ $locals: { env } });
}

export async function createBackfill(env: Record<string, string>, id: string, payload: unknown) {
  const doc = new FaspClientBackfill({ _id: id, payload, status: "pending" });
  (doc as unknown as { $locals?: { env?: Record<string, string> } }).$locals = { env };
  await doc.save();
}

export async function continueBackfill(env: Record<string, string>, id: string) {
  await FaspClientBackfill.updateOne({ _id: id }, { $set: { continuedAt: new Date() } })
    .setOptions({ $locals: { env } });
}

export async function registrationUpsert(env: Record<string, string>, data: {
  name: string; baseUrl: string; serverId: string; publicKey: string; faspId: string;
}) {
  const existing = await FaspClientProvider.findOne({
    $or: [{ serverId: data.serverId }, { baseUrl: data.baseUrl }],
  }).setOptions({ $locals: { env } });
  const now = new Date();
  if (existing && existing.status === "approved") {
    await FaspClientProvider.updateOne(
      { _id: existing._id },
      { $set: { name: data.name, baseUrl: data.baseUrl, serverId: data.serverId, publicKey: data.publicKey, updatedAt: now } },
    ).setOptions({ $locals: { env } });
    return existing.toObject();
  }
  await FaspClientProvider.updateOne(
    { $or: [{ serverId: data.serverId }, { baseUrl: data.baseUrl }] },
    {
      $set: {
        name: data.name,
        baseUrl: data.baseUrl,
        serverId: data.serverId,
        publicKey: data.publicKey,
        status: "pending",
        approvedAt: null,
        rejectedAt: null,
        updatedAt: now,
      },
      $setOnInsert: { faspId: data.faspId },
    },
    { upsert: true },
  ).setOptions({ $locals: { env } });
}

