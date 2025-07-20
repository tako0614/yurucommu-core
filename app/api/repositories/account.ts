import Account from "../models/account.ts";

export interface AccountData {
  _id?: string;
  userName: string;
  displayName: string;
  avatarInitial: string;
  privateKey: string;
  publicKey: string;
  followers: string[];
  following: string[];
}

export async function listAccounts(
  env: Record<string, string>,
): Promise<AccountData[]> {
  const tenantId = env["ACTIVITYPUB_DOMAIN"] ?? "";
  return await Account.find({ tenant_id: tenantId }).lean<AccountData[]>();
}

export async function createAccount(
  env: Record<string, string>,
  data: AccountData,
): Promise<AccountData> {
  const doc = new Account({
    ...data,
    tenant_id: env["ACTIVITYPUB_DOMAIN"] ?? "",
  });
  (doc as unknown as { $locals?: { env?: Record<string, string> } }).$locals = {
    env,
  };
  await doc.save();
  return doc.toObject() as AccountData;
}

export async function findAccountById(
  env: Record<string, string>,
  id: string,
): Promise<AccountData | null> {
  const tenantId = env["ACTIVITYPUB_DOMAIN"] ?? "";
  return await Account.findOne({ _id: id, tenant_id: tenantId }).lean<
    AccountData | null
  >();
}

export async function findAccountByUserName(
  env: Record<string, string>,
  username: string,
): Promise<AccountData | null> {
  const tenantId = env["ACTIVITYPUB_DOMAIN"] ?? "";
  return await Account.findOne({ userName: username, tenant_id: tenantId })
    .lean<AccountData | null>();
}

export async function updateAccountById(
  env: Record<string, string>,
  id: string,
  update: Record<string, unknown>,
): Promise<AccountData | null> {
  const tenantId = env["ACTIVITYPUB_DOMAIN"] ?? "";
  return await Account.findOneAndUpdate(
    { _id: id, tenant_id: tenantId },
    update,
    { new: true },
  ).lean<AccountData | null>();
}

export async function deleteAccountById(
  env: Record<string, string>,
  id: string,
): Promise<boolean> {
  const tenantId = env["ACTIVITYPUB_DOMAIN"] ?? "";
  const res = await Account.findOneAndDelete({ _id: id, tenant_id: tenantId });
  return !!res;
}

export async function addFollower(
  env: Record<string, string>,
  id: string,
  follower: string,
): Promise<string[]> {
  const tenantId = env["ACTIVITYPUB_DOMAIN"] ?? "";
  const acc = await Account.findOneAndUpdate({ _id: id, tenant_id: tenantId }, {
    $addToSet: { followers: follower },
  }, { new: true });
  return acc?.followers ?? [];
}

export async function removeFollower(
  env: Record<string, string>,
  id: string,
  follower: string,
): Promise<string[]> {
  const tenantId = env["ACTIVITYPUB_DOMAIN"] ?? "";
  const acc = await Account.findOneAndUpdate({ _id: id, tenant_id: tenantId }, {
    $pull: { followers: follower },
  }, { new: true });
  return acc?.followers ?? [];
}

export async function addFollowing(
  env: Record<string, string>,
  id: string,
  target: string,
): Promise<string[]> {
  const tenantId = env["ACTIVITYPUB_DOMAIN"] ?? "";
  const acc = await Account.findOneAndUpdate({ _id: id, tenant_id: tenantId }, {
    $addToSet: { following: target },
  }, { new: true });
  return acc?.following ?? [];
}

export async function removeFollowing(
  env: Record<string, string>,
  id: string,
  target: string,
): Promise<string[]> {
  const tenantId = env["ACTIVITYPUB_DOMAIN"] ?? "";
  const acc = await Account.findOneAndUpdate({ _id: id, tenant_id: tenantId }, {
    $pull: { following: target },
  }, { new: true });
  return acc?.following ?? [];
}

export async function addFollowerByName(
  env: Record<string, string>,
  username: string,
  follower: string,
) {
  const tenantId = env["ACTIVITYPUB_DOMAIN"] ?? "";
  await Account.updateOne({ userName: username, tenant_id: tenantId }, {
    $addToSet: { followers: follower },
  });
}

export async function removeFollowerByName(
  env: Record<string, string>,
  username: string,
  follower: string,
) {
  const tenantId = env["ACTIVITYPUB_DOMAIN"] ?? "";
  await Account.updateOne({ userName: username, tenant_id: tenantId }, {
    $pull: { followers: follower },
  });
}

export async function searchAccounts(
  env: Record<string, string>,
  query: RegExp,
  limit = 20,
): Promise<AccountData[]> {
  const tenantId = env["ACTIVITYPUB_DOMAIN"] ?? "";
  return await Account.find({
    tenant_id: tenantId,
    $or: [{ userName: query }, { displayName: query }],
  })
    .limit(limit)
    .lean<AccountData[]>();
}

export async function updateAccountByUserName(
  env: Record<string, string>,
  username: string,
  update: Record<string, unknown>,
) {
  const tenantId = env["ACTIVITYPUB_DOMAIN"] ?? "";
  await Account.updateOne(
    { userName: username, tenant_id: tenantId },
    update,
  );
}

export async function findAccountsByUserNames(
  env: Record<string, string>,
  usernames: string[],
): Promise<AccountData[]> {
  const tenantId = env["ACTIVITYPUB_DOMAIN"] ?? "";
  return await Account.find({
    tenant_id: tenantId,
    userName: { $in: usernames },
  }).lean<AccountData[]>();
}

export async function countAccounts(
  env: Record<string, string>,
): Promise<number> {
  const tenantId = env["ACTIVITYPUB_DOMAIN"] ?? "";
  return await Account.countDocuments(tenantId ? { tenant_id: tenantId } : {});
}
