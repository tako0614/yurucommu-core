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
