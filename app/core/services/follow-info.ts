import type { DataStore } from "../db/types.ts";

/**
 * ユーザーが存在しない場合のエラー
 */
export class UserNotFoundError extends Error {
  constructor(message = "User not found") {
    super(message);
    this.name = "UserNotFoundError";
  }
}

/**
 * 指定したユーザーのフォロー/フォロワー一覧を取得
 */
export async function getFollowList(
  db: DataStore,
  username: string,
  type: "followers" | "following",
): Promise<string[]> {
  const account = await db.accounts.findByUserName(username);
  if (!account) {
    throw new UserNotFoundError();
  }
  return (account[type] ?? []) as string[];
}

export interface FollowInfo {
  userName: string;
  displayName: string;
  avatarInitial: string;
  domain: string;
}

/**
 * URL のリストをローカル向けオブジェクト配列へ変換
 */
export async function formatFollowList(
  db: DataStore,
  list: string[],
  domain: string,
): Promise<FollowInfo[]> {
  const result: FollowInfo[] = [];
  for (const url of list) {
    try {
      if (url.includes(domain)) {
        const name = url.split("/").pop();
        const acc = await db.accounts.findByUserName(name ?? "");
        if (acc) {
          result.push({
            userName: acc.userName,
            displayName: acc.displayName,
            avatarInitial: acc.avatarInitial || "",
            domain,
          });
        }
      } else {
        const remoteName = url.split("/").pop();
        const remoteDomain = new URL(url).host;
        result.push({
          userName: remoteName ?? "",
          displayName: remoteName ?? "",
          avatarInitial: "",
          domain: remoteDomain,
        });
      }
    } catch (err) {
      console.error("Error processing follow:", err);
    }
  }
  return result;
}

/**
 * API 用フォロー情報取得
 */
export async function getFormattedFollowInfo(
  db: DataStore,
  username: string,
  type: "followers" | "following",
  domain: string,
): Promise<FollowInfo[]> {
  const list = await getFollowList(db, username, type);
  return await formatFollowList(db, list, domain);
}

/**
 * ActivityPub 用フォロー情報生成
 */
export async function buildActivityPubFollowCollection(
  db: DataStore,
  username: string,
  type: "followers" | "following",
  page: string | undefined,
  domain: string,
): Promise<Record<string, unknown>> {
  const list = await getFollowList(db, username, type);
  const baseId = `https://${domain}/ap/users/${username}/${type}`;
  if (page) {
    return {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: `${baseId}?page=1`,
      type: "OrderedCollectionPage",
      partOf: baseId,
      orderedItems: list,
      next: null,
      prev: null,
    };
  }
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: baseId,
    type: "OrderedCollection",
    totalItems: list.length,
    first: `${baseId}?page=1`,
  };
}
