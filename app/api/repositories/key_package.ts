export interface KeyPackageData {
  _id?: string;
  userName: string;
  content: string;
  mediaType: string;
  encoding: string;
  createdAt?: Date;
}

import KeyPackage from "../models/key_package.ts";

export async function listKeyPackages(
  env: Record<string, string>,
  userName: string,
): Promise<KeyPackageData[]> {
  const tenantId = env["ACTIVITYPUB_DOMAIN"] ?? "";
  return await KeyPackage.find({ userName, tenant_id: tenantId }).lean<
    KeyPackageData[]
  >();
}

export async function findKeyPackage(
  env: Record<string, string>,
  userName: string,
  id: string,
): Promise<KeyPackageData | null> {
  const tenantId = env["ACTIVITYPUB_DOMAIN"] ?? "";
  return await KeyPackage.findOne({ _id: id, userName, tenant_id: tenantId })
    .lean<KeyPackageData | null>();
}

export async function createKeyPackage(
  env: Record<string, string>,
  userName: string,
  content: string,
  mediaType = "message/mls",
  encoding = "base64",
): Promise<KeyPackageData> {
  const doc = new KeyPackage({
    userName,
    content,
    mediaType,
    encoding,
    tenant_id: env["ACTIVITYPUB_DOMAIN"] ?? "",
  });
  (doc as unknown as { $locals?: { env?: Record<string, string> } }).$locals = {
    env,
  };
  await doc.save();
  return doc.toObject() as KeyPackageData;
}

export async function deleteKeyPackage(
  env: Record<string, string>,
  userName: string,
  id: string,
): Promise<void> {
  const tenantId = env["ACTIVITYPUB_DOMAIN"] ?? "";
  await KeyPackage.deleteOne({ _id: id, userName, tenant_id: tenantId });
}

export async function deleteKeyPackagesByUser(
  env: Record<string, string>,
  userName: string,
): Promise<void> {
  const tenantId = env["ACTIVITYPUB_DOMAIN"] ?? "";
  await KeyPackage.deleteMany({ userName, tenant_id: tenantId });
}
