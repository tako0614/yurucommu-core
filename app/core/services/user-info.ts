import { createDB } from "../db/mod.ts";
import { resolveActorFromAcct } from "../utils/activitypub.ts";

export interface UserInfo {
  userName: string;
  displayName: string;
  authorAvatar: string;
  domain: string;
  isLocal: boolean;
}

export interface UserInfoCache {
  [key: string]: UserInfo;
}

/**
 * 単一のユーザー情報を取得する
 */
export async function getUserInfo(
  acct: string,
  domain: string,
  env: Record<string, string>,
  cache?: UserInfoCache,
): Promise<UserInfo> {
  if (cache && cache[acct]) {
    return cache[acct];
  }

  const db = createDB(env);
  const [userName, userDomain] = acct.split("@");
  let displayName = userName;
  let authorAvatar = "";
  const isLocal = userDomain === domain;

  if (isLocal) {
    const account = await db.findAccountByUserName(userName);
    if (account) {
      displayName = account.displayName || userName;
      authorAvatar = account.avatarInitial || "/api/image/people.png";
    }
  } else {
    const actor = await resolveActorFromAcct(acct).catch(() => null);
    if (actor) {
      displayName = actor.name ?? actor.preferredUsername ?? userName;
      const icon = actor.icon;
      if (icon) {
        authorAvatar = typeof icon === "object" && icon !== null
          ? (icon as { url?: string }).url ?? ""
          : typeof icon === "string"
          ? icon
          : "";
      }
      await db.upsertRemoteActor({
        actorUrl: actor.id,
        name: actor.name || "",
        preferredUsername: actor.preferredUsername || "",
        icon: actor.icon || null,
        summary: actor.summary || "",
      });
    }
  }

  const userInfo: UserInfo = {
    userName,
    displayName,
    authorAvatar,
    domain: userDomain,
    isLocal,
  };

  if (cache) {
    cache[acct] = userInfo;
  }

  return userInfo;
}

/**
 * 複数のユーザー情報をバッチで取得する
 */
export async function getUserInfoBatch(
  accts: string[],
  domain: string,
  env: Record<string, string>,
): Promise<UserInfo[]> {
  const cache: UserInfoCache = {};
  const results: UserInfo[] = [];
  const db = createDB(env);

  const uniqueAccts = [...new Set(accts)];
  const localNames = uniqueAccts
    .filter((a) => a.endsWith(`@${domain}`))
    .map((a) => a.split("@")[0]);

  if (localNames.length > 0) {
    const accounts = await db.findAccountsByUserNames(localNames);
    for (const acc of accounts) {
      const acct = `${acc.userName}@${domain}`;
      cache[acct] = {
        userName: acc.userName,
        displayName: acc.displayName || acc.userName,
        authorAvatar: acc.avatarInitial || "/api/image/people.png",
        domain,
        isLocal: true,
      };
    }
  }

  for (const acct of uniqueAccts) {
    if (!cache[acct]) {
      const info = await getUserInfo(acct, domain, env, cache);
      cache[acct] = info;
    }
  }

  for (const acct of accts) {
    if (cache[acct]) {
      results.push(cache[acct]);
    }
  }

  return results;
}

export function formatUserInfoForPost(
  userInfo: UserInfo,
  postData: Record<string, unknown>,
) {
  return {
    id: typeof postData._id === "string"
      ? postData._id
      : typeof postData._id === "object" && postData._id !== null &&
          "toString" in postData._id
      ? (postData._id as { toString: () => string }).toString()
      : "",
    userName: userInfo.userName,
    displayName: userInfo.displayName,
    authorAvatar: userInfo.authorAvatar,
    content: postData.content,
    createdAt: postData.published,
    likes: Array.isArray((postData.extra as Record<string, unknown>)?.likedBy)
      ? ((postData.extra as Record<string, unknown>).likedBy as unknown[])
        .length
      : (postData.extra as Record<string, unknown>)?.likes ?? 0,
    retweets: (postData.extra as Record<string, unknown>)?.retweets ?? 0,
    replies: (postData.extra as Record<string, unknown>)?.replies ?? 0,
    attachments:
      Array.isArray((postData.extra as Record<string, unknown>)?.attachments)
        ? (postData.extra as Record<string, unknown>).attachments as unknown[]
        : [],
    parentId: (postData.extra as Record<string, unknown>)?.inReplyTo,
    quoteId: (postData.extra as Record<string, unknown>)?.quoteId,
    domain: userInfo.domain,
  };
}
