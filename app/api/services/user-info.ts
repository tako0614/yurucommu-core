import Account from "../models/account.ts";
import RemoteActor from "../models/remote_actor.ts";

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

async function fetchExternalActorInfo(actorUrl: string) {
  let actor = await RemoteActor.findOne({ actorUrl }).lean();
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
        await RemoteActor.findOneAndUpdate(
          { actorUrl },
          {
            name: data.name || "",
            preferredUsername: data.preferredUsername || "",
            icon: data.icon || null,
            summary: data.summary || "",
            cachedAt: new Date(),
          },
          { upsert: true },
        );
        actor = await RemoteActor.findOne({ actorUrl }).lean();
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
  cache?: UserInfoCache,
): Promise<UserInfo> {
  // キャッシュチェック
  if (cache && cache[identifier]) {
    return cache[identifier];
  }

  let userName = identifier;
  let displayName = userName;
  let authorAvatar = "";
  let userDomain = domain;
  let isLocal = true;

  // ローカルユーザーかどうかを判定
  const account = await Account.findOne({ userName: identifier }).lean();

  if (account) {
    // ローカルユーザーの場合
    displayName = account.displayName || userName;
    authorAvatar = account.avatarInitial || "";
  } else if (typeof identifier === "string" && identifier.startsWith("http")) {
    // 外部ユーザーの場合（ActivityPub URL）
    isLocal = false;
    try {
      const url = new URL(identifier);
      userDomain = url.hostname;

      // URLから適切なユーザー名を抽出
      const pathParts = url.pathname.split("/");
      const extractedUsername = pathParts[pathParts.length - 1] ||
        pathParts[pathParts.length - 2] ||
        "external_user";

      userName = extractedUsername;
      displayName = extractedUsername;

      // 外部アクター情報を取得
      const info = await fetchExternalActorInfo(identifier);
      if (info) {
        displayName = info.displayName || displayName;
        authorAvatar = info.avatar;
      }
    } catch {
      userDomain = "external";
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
): Promise<UserInfo[]> {
  const cache: UserInfoCache = {};
  const results: UserInfo[] = [];

  // 重複を除去
  const uniqueIdentifiers = [...new Set(identifiers)];

  // ローカルユーザーをバッチで取得
  const localUsernames = uniqueIdentifiers.filter((id) =>
    !id.startsWith("http")
  );
  if (localUsernames.length > 0) {
    const accounts = await Account.find({ userName: { $in: localUsernames } })
      .lean();
    const accountMap = new Map(accounts.map((acc) => [acc.userName, acc]));

    for (const username of localUsernames) {
      const account = accountMap.get(username);
      if (account) {
        const userInfo: UserInfo = {
          userName: username,
          displayName: account.displayName || username,
          authorAvatar: account.avatarInitial || "",
          domain,
          isLocal: true,
        };
        cache[username] = userInfo;
      }
    }
  }

  // 外部ユーザーをバッチで取得
  const externalUrls = uniqueIdentifiers.filter((id) => id.startsWith("http"));
  if (externalUrls.length > 0) {
    const remoteActors = await RemoteActor.find({
      actorUrl: { $in: externalUrls },
    }).lean();
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
      const userInfo = await getUserInfo(identifier, domain, cache);
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
    domain: userInfo.domain,
  };
}
