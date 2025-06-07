import { z } from "zod";
import { eventManager } from "../eventManager.ts";
import { Account } from "../models/account.ts";
import { load } from "@std/dotenv";
const _env = await load();

eventManager.add(
  "takos",
  "accounts:create",
  z.object({
    username: z.string(),
  }),
  async (_c, payload) => {
    try {
      // 重複チェック
      const existingAccount = await Account.findOne({ name: payload.username });
      if (existingAccount) {
        throw new Error("このユーザー名は既に使用されています");
      }

      const account = new Account({
        name: payload.username,
        displayName: payload.username,
        icon: payload.username.charAt(0).toUpperCase(), // デフォルトアイコン
        activityPubActor: {},
        publicKeyPem: "dummy_public_key",
        privateKeyPem: "dummy_private_key",
      });

      await account.save();

      return {
        id: account._id.toString(),
        userName: account.name,
        displayName: account.displayName,
        avatarInitial: account.icon,
      };
    } catch (error) {
      console.error("Account creation error:", error);
      if (
        error && typeof error === "object" && "code" in error &&
        error.code === 11000
      ) {
        throw new Error("このユーザー名は既に使用されています");
      }
      throw error;
    }
  },
);

eventManager.add(
  "takos",
  "accounts:delete",
  z.object({
    username: z.string(),
  }),
  async (_c, payload) => {
    try {
      const result = await Account.findOneAndDelete({ name: payload.username });
      if (!result) {
        throw new Error("Account not found");
      }
      return { success: true, deletedAccount: result.name };
    } catch (error) {
      console.error("Account deletion error:", error);
      throw new Error("Failed to delete account");
    }
  },
);

eventManager.add(
  "takos",
  "accounts:edit",
  z.object({
    username: z.string(),
    newUsername: z.string().optional(),
    newDisplayName: z.string().optional(),
    icon: z.string().optional(), // アイコンは文字列（初期値またはデータURL）    description: z.string().optional(),
  }),
  async (_c, payload) => {
    try {
      const updateData: Record<string, unknown> = {};

      // 新しいユーザー名が指定されている場合の重複チェック
      if (payload.newUsername) {
        const existingAccount = await Account.findOne({
          $and: [
            { name: payload.newUsername },
            { name: { $ne: payload.username } }, // 現在のアカウント以外
          ],
        });
        if (existingAccount) {
          throw new Error("このユーザー名は既に使用されています");
        }
        updateData.name = payload.newUsername;
      }

      if (payload.newDisplayName) {
        updateData.displayName = payload.newDisplayName;
      }
      // icon が提供されていれば、それをそのまま使用 (データURLまたは文字列)
      if (payload.icon !== undefined) updateData.icon = payload.icon;

      // IDまたは名前で検索するように変更
      const query = payload.username.length === 24 &&
          /^[0-9a-fA-F]{24}$/.test(payload.username)
        ? { _id: payload.username } // ObjectIdの場合
        : { name: payload.username }; // 名前の場合

      const account = await Account.findOneAndUpdate(
        query,
        updateData,
        { new: true },
      );

      if (!account) {
        throw new Error("アカウントが見つかりません");
      }

      return {
        id: account._id.toString(),
        userName: account.name,
        displayName: account.displayName,
        avatarInitial: account.icon, // 更新されたアイコンを返す
      };
    } catch (error) {
      console.error("Account update error:", error);
      if (
        error instanceof Error && "code" in error &&
        (error as { code: number }).code === 11000
      ) {
        throw new Error("このユーザー名は既に使用されています");
      }
      throw error;
    }
  },
);

eventManager.add(
  "takos",
  "accounts:list",
  z.unknown(),
  async (_c, _payload) => {
    try {
      const accounts = await Account.find({});
      return accounts.map((account) => ({
        id: account._id.toString(),
        userName: account.name,
        displayName: account.displayName,
        avatarInitial: account.icon,
      }));
    } catch (error) {
      console.error("Account list error:", error);
      throw new Error("Failed to fetch accounts");
    }
  },
);
