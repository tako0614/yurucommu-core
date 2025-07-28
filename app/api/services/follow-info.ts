import { createDB } from "../DB/mod.ts";
import type { DB } from "../../shared/db.ts";

/**
 * 指定したユーザーのフォロー/フォロワー一覧を取得
 */
export async function getFollowList(
  username: string,
  type: "followers" | "following",
  env: Record<string, string>,
  dbInst?: DB,
): Promise<string[]> {
  const db = dbInst ?? createDB(env);
  const account = await db.findAccountByUserName(username);
  if (!account) {
    throw new Error("User not found");
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
  list: string[],
  domain: string,
  env: Record<string, string>,
  dbInst?: DB,
): Promise<FollowInfo[]> {
  const db = dbInst ?? createDB(env);
  const result: FollowInfo[] = [];
  for (const url of list) {
    try {
      if (url.includes(domain)) {
        const name = url.split("/").pop();
        const acc = await db.findAccountByUserName(name ?? "");
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
  username: string,
  type: "followers" | "following",
  domain: string,
  env: Record<string, string>,
  dbInst?: DB,
): Promise<FollowInfo[]> {
  const list = await getFollowList(username, type, env, dbInst);
  return await formatFollowList(list, domain, env, dbInst);
}

/**
 * ActivityPub 用フォロー情報生成
 */
export async function buildActivityPubFollowCollection(
  username: string,
  type: "followers" | "following",
  page: string | undefined,
  domain: string,
  env: Record<string, string>,
  dbInst?: DB,
): Promise<Record<string, unknown>> {
  const list = await getFollowList(username, type, env, dbInst);
  const baseId = `https://${domain}/users/${username}/${type}`;
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
