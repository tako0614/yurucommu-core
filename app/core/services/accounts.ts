import type { DataStore } from "../db/types.ts";
import type { AccountDoc } from "@takos/types";

/** アカウント一覧を取得し、system アカウントを除外します */
export async function listAccounts(db: DataStore): Promise<AccountDoc[]> {
  const list = await db.accounts.list();
  return list.filter((doc) => doc.userName !== "system");
}

/** ユーザー名でアカウントを検索します */
export function findAccountByUserName(
  db: DataStore,
  userName: string,
): Promise<AccountDoc | null> {
  return db.accounts.findByUserName(userName);
}

/** アカウントを作成します */
export function createAccount(
  db: DataStore,
  data: Record<string, unknown>,
): Promise<AccountDoc> {
  return db.accounts.create(data);
}

/** ID でアカウントを取得します */
export function findAccountById(
  db: DataStore,
  id: string,
): Promise<AccountDoc | null> {
  return db.accounts.findById(id);
}

/** ID でアカウントを更新します */
export function updateAccountById(
  db: DataStore,
  id: string,
  update: Record<string, unknown>,
): Promise<AccountDoc | null> {
  return db.accounts.updateById(id, update);
}

/** ID でアカウントを削除します */
export function deleteAccountById(
  db: DataStore,
  id: string,
): Promise<boolean> {
  return db.accounts.deleteById(id);
}
