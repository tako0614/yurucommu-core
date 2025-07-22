import { createDB } from "../db.ts";
import type { DB } from "../../shared/db.ts";
import { resolveActor } from "../utils/activitypub.ts";

function isUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

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

interface RemoteActorCache {
  actorUrl?: string;
  name?: string;
  preferredUsername?: string;
  icon?: unknown;
  summary?: string;
}

async function fetchExternalActorInfo(actorUrl: string, db: DB) {
  let actor = await db.findRemoteActorByUrl(actorUrl) as
    | RemoteActorCache
    | null;
  if (!actor || !(actor.name || actor.preferredUsername) || !actor.icon) {
    try {
      const res = await fetch(actorUrl, {
        headers: {
          "Accept":
            'application/activity+json, application/ld+json; profile="https://www.w3.org/ns/activitystreams"',
          "User-Agent": "Takos ActivityPub Client/1.0",
        },
      });
      if (res.ok) {
        const data = await res.json();
        await db.upsertRemoteActor({
          actorUrl,
          name: data.name || "",
          preferredUsername: data.preferredUsername || "",
          icon: data.icon || null,
          summary: data.summary || "",
        });
        actor = await db.findRemoteActorByUrl(actorUrl);
      }
    } catch {
      /* ignore */
    }
  }
  if (!actor) return null;
  const avatar = actor.icon
    ? typeof actor.icon === "object" && actor.icon !== null
      ? (actor.icon as Record<string, string>).url ?? ""
      : (actor.icon as string)
    : "";
  return {
    displayName: (actor.name as string) ||
      (actor.preferredUsername as string) ||
      "",
    avatar,
  };
}

/**
 * 単一のユーザー情報を取得する
 */
export async function getUserInfo(
  identifier: string,
  domain: string,
  env: Record<string, string>,
  cache?: UserInfoCache,
): Promise<UserInfo> {
  // キャッシュチェック
  if (cache && cache[identifier]) {
    return cache[identifier];
  }

  const db = createDB(env);

  let userName = identifier;
  let displayName = userName;
  let authorAvatar = "";
  let userDomain = domain;
  let isLocal = true;

  // ローカルユーザーかどうかを判定
  const account = await db.findAccountByUserName(identifier);

  if (account) {
    // ローカルユーザーの場合
    displayName = account.displayName || userName;
    authorAvatar = account.avatarInitial || "";
  } else if (identifier.includes("@") && !isUrl(identifier)) {
    // user@domain 形式の外部ユーザー
    isLocal = false;
    const [name, host] = identifier.split("@");
    userName = name;
    userDomain = host;
    const actor = await resolveActor(name, host);
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
  } else if (typeof identifier === "string" && isUrl(identifier)) {
    try {
      const url = new URL(identifier);
      const pathParts = url.pathname.split("/");
      const extractedUsername = pathParts[pathParts.length - 1] ||
        pathParts[pathParts.length - 2] ||
        "external_user";

      userName = extractedUsername;

      if (url.hostname === domain && url.pathname.startsWith("/users/")) {
        // ローカルユーザーを URL で指定した場合
        const localAccount = await db.findAccountByUserName(extractedUsername);
        if (localAccount) {
          displayName = localAccount.displayName || extractedUsername;
          authorAvatar = localAccount.avatarInitial || "";
        } else {
          displayName = extractedUsername;
        }
        userDomain = domain;
        isLocal = true;
      } else {
        // 外部ユーザーの場合（ActivityPub URL）
        userDomain = url.hostname;
        isLocal = false;

        const info = await fetchExternalActorInfo(identifier, db);
        if (info) {
          displayName = info.displayName || extractedUsername;
          authorAvatar = info.avatar;
        } else {
          displayName = extractedUsername;
        }
      }
    } catch {
      userDomain = "external";
      isLocal = false;
    }
  }

  const userInfo: UserInfo = {
    userName,
    displayName,
    authorAvatar,
    domain: userDomain,
    isLocal,
  };

  // キャッシュに保存
  if (cache) {
    cache[identifier] = userInfo;
  }

  return userInfo;
}

/**
 * 複数のユーザー情報をバッチで取得する
 */
export async function getUserInfoBatch(
  identifiers: string[],
  domain: string,
  env: Record<string, string>,
): Promise<UserInfo[]> {
  const cache: UserInfoCache = {};
  const results: UserInfo[] = [];

  const db = createDB(env);

  // 重複を除去
  const uniqueIdentifiers = [...new Set(identifiers)];

  // ローカルユーザーをバッチで取得
  const localIds: { id: string; username: string }[] = [];
  for (const id of uniqueIdentifiers) {
    if (!isUrl(id) && !id.includes("@")) {
      localIds.push({ id, username: id });
    } else if (isUrl(id)) {
      try {
        const urlObj = new URL(id);
        if (
          urlObj.hostname === domain && urlObj.pathname.startsWith("/users/")
        ) {
          const parts = urlObj.pathname.split("/");
          const uname = parts[parts.length - 1] || parts[parts.length - 2];
          if (uname) localIds.push({ id, username: uname });
        }
      } catch {
        /* ignore */
      }
    }
  }

  if (localIds.length > 0) {
    const accounts = await db.findAccountsByUserNames(
      localIds.map((l) => l.username),
    );
    const accountMap = new Map(accounts.map((acc) => [acc.userName, acc]));

    for (const entry of localIds) {
      const account = accountMap.get(entry.username);
      if (account) {
        const userInfo: UserInfo = {
          userName: entry.username,
          displayName: account.displayName || entry.username,
          authorAvatar: account.avatarInitial || "",
          domain,
          isLocal: true,
        };
        cache[entry.id] = userInfo;
      }
    }
  }

  // 外部ユーザーをバッチで取得
  const processedLocalIds = new Set(localIds.map((l) => l.id));
  const externalUrls = uniqueIdentifiers.filter((id) =>
    isUrl(id) && !processedLocalIds.has(id)
  );
  if (externalUrls.length > 0) {
    const remoteActors = await db.findRemoteActorsByUrls(
      externalUrls,
    ) as RemoteActorCache[];
    const actorMap = new Map(
      remoteActors.map((actor) => [actor.actorUrl, actor]),
    );

    for (const url of externalUrls) {
      const actor = actorMap.get(url);
      if (actor) {
        try {
          const urlObj = new URL(url);
          const pathParts = urlObj.pathname.split("/");
          const extractedUsername = pathParts[pathParts.length - 1] ||
            pathParts[pathParts.length - 2] ||
            "external_user";

          const avatar = actor.icon
            ? typeof actor.icon === "object" && actor.icon !== null
              ? (actor.icon as Record<string, string>).url ?? ""
              : (actor.icon as string)
            : "";

          const userInfo: UserInfo = {
            userName: extractedUsername,
            displayName: (actor.name as string) ||
              (actor.preferredUsername as string) ||
              extractedUsername,
            authorAvatar: avatar,
            domain: urlObj.hostname,
            isLocal: false,
          };
          cache[url] = userInfo;
        } catch {
          // URLパースエラーの場合はデフォルト値を設定
          const userInfo: UserInfo = {
            userName: "external_user",
            displayName: "external_user",
            authorAvatar: "",
            domain: "external",
            isLocal: false,
          };
          cache[url] = userInfo;
        }
      }
    }
  }

  // 結果を順序通りに並べる
  for (const identifier of identifiers) {
    if (cache[identifier]) {
      results.push(cache[identifier]);
    } else {
      // キャッシュにない場合は個別に取得
      const userInfo = await getUserInfo(identifier, domain, env, cache);
      results.push(userInfo);
    }
  }

  return results;
}

/**
 * ユーザー情報をフォーマットしてレスポンス形式に変換する
 */
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
