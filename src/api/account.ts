import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { Session } from "./models/sessions.ts";
import { Env } from "./index.ts";
import { Account } from "./models/account.ts"; // Accountモデルをインポート
import mongoose from "mongoose"; // mongoose.Types.ObjectId を使用するため
import {
  exportPrivateKeyToPem,
  exportPublicKeyToPem,
  generateRsaKeyPair,
} from "./utils/crypto.ts"; // キー生成関数をインポート

const app = new Hono<{ Bindings: Env }>();

// 認証ミドルウェア
app.use("*", async (c, next) => {
  const sessionToken = getCookie(c, "session_token");
  if (!sessionToken) {
    return c.json({ success: false, error: "認証されていません" }, 401);
  }
  const session = await Session.findOne({
    token: sessionToken,
    expiresAt: { $gt: new Date() },
  });
  if (!session) {
    setCookie(c, "session_token", "", { maxAge: 0, path: "/" });
    return c.json({ success: false, error: "セッションが無効です" }, 401);
  }
  await next();
});

// アカウント作成
app.post("/", async (c) => {
  try {
    const body = await c.req.json();
    const { name, icon } = body;
    const domain = c.env.ACTIVITYPUB_DOMAIN;

    if (!name || typeof name !== "string" || name.trim() === "") {
      return c.json({ success: false, error: "名前は必須です" }, 400);
    }
    if (!icon || typeof icon !== "string" || icon.trim() === "") {
      return c.json({ success: false, error: "アイコンURLは必須です" }, 400);
    }
    // name のユニーク制約はモデル側にあるが、ここでもチェック
    const existingAccount = await Account.findOne({ name });
    if (existingAccount) {
      return c.json(
        { success: false, error: "その名前は既に使用されています" },
        409,
      );
    }

    // キーペア生成
    const keyPair = await generateRsaKeyPair();
    const publicKeyPem = await exportPublicKeyToPem(keyPair.publicKey);
    const privateKeyPem = await exportPrivateKeyToPem(keyPair.privateKey);

    const actorId = `https://${domain}/users/${name}`;

    const activityPubActor = {
      "@context": [
        "https://www.w3.org/ns/activitystreams",
        "https://w3id.org/security/v1",
      ],
      id: actorId,
      type: "Person",
      preferredUsername: name,
      name: name,
      inbox: `${actorId}/inbox`,
      outbox: `${actorId}/outbox`,
      icon: {
        type: "Image",
        mediaType: "image/png",
        url: icon,
      },
      publicKey: { // 公開鍵情報を追加
        id: `${actorId}#main-key`,
        owner: actorId,
        publicKeyPem: publicKeyPem,
      },
    };

    const newAccount = await Account.create({
      name,
      icon,
      activityPubActor,
      publicKeyPem, // DBに保存
      privateKeyPem, // DBに保存
    });
    return c.json({ success: true, data: newAccount }, 201);
  } catch (error) {
    console.error("Account creation error:", error);
    if ((error as { code?: number })?.code === 11000) { // MongoDB duplicate key error
      return c.json(
        { success: false, error: "その名前は既に使用されています" },
        409,
      );
    }
    return c.json(
      { success: false, error: "アカウント作成中にエラーが発生しました" },
      500,
    );
  }
});

// アカウント一覧取得
app.get("/", async (c) => {
  try {
    const accounts = await Account.find({});
    return c.json({ success: true, data: accounts });
  } catch (error) {
    console.error("Error fetching accounts:", error);
    return c.json(
      { success: false, error: "アカウント取得中にエラーが発生しました" },
      500,
    );
  }
});

// 特定のアカウント取得
app.get("/:id", async (c) => {
  try {
    const { id } = c.req.param();
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return c.json({ success: false, error: "無効なID形式です" }, 400);
    }
    const account = await Account.findById(id);
    if (!account) {
      return c.json(
        { success: false, error: "アカウントが見つかりません" },
        404,
      );
    }
    return c.json({ success: true, data: account });
  } catch (error) {
    console.error("Error fetching account:", error);
    return c.json(
      { success: false, error: "アカウント取得中にエラーが発生しました" },
      500,
    );
  }
});

// アカウント更新
app.put("/:id", async (c) => {
  try {
    const { id } = c.req.param();
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return c.json({ success: false, error: "無効なID形式です" }, 400);
    }
    const body = await c.req.json();
    const { name, icon } = body;
    const domain = c.env.ACTIVITYPUB_DOMAIN;

    const updateData: { name?: string; icon?: string; activityPubActor?: unknown } =
      {};

    const accountToUpdate = await Account.findById(id);
    if (!accountToUpdate) {
      return c.json(
        { success: false, error: "アカウントが見つかりません" },
        404,
      );
    }

    let currentName = accountToUpdate.name;
    let actorId = accountToUpdate.activityPubActor.id; // 既存のActor ID

    if (name && typeof name === "string" && name.trim() !== "") {
      // 名前が変更される場合、他のアカウントと重複しないかチェック
      if (name !== accountToUpdate.name) {
        const existingAccount = await Account.findOne({
          name: name,
          _id: { $ne: id },
        });
        if (existingAccount) {
          return c.json({
            success: false,
            error: "その名前は既に使用されています",
          }, 409);
        }
      }
      updateData.name = name;
      currentName = name; // ActorのID生成用に更新
      actorId = `https://${domain}/users/${currentName}`; // Actor IDも更新
    }
    if (icon && typeof icon === "string" && icon.trim() !== "") {
      updateData.icon = icon;
    }

    // name または icon が更新される場合、activityPubActor も更新
    if (updateData.name || updateData.icon) {
      updateData.activityPubActor = {
        ...accountToUpdate.activityPubActor,
        id: actorId,
        preferredUsername: currentName,
        name: currentName,
        inbox: `${actorId}/inbox`,
        outbox: `${actorId}/outbox`,
        icon: {
          type: "Image",
          mediaType: "image/png",
          url: updateData.icon || accountToUpdate.icon,
        },
        publicKey: { // 公開鍵情報を更新/維持
          id: `${actorId}#main-key`,
          owner: actorId,
          publicKeyPem: accountToUpdate.publicKeyPem, // 公開鍵自体は変更しない
        },
      };
      // @context や type は不変なので、既存のものをそのまま使う
      if (accountToUpdate.activityPubActor["@context"]) {
        (updateData.activityPubActor as Record<string, unknown>)["@context"] =
          accountToUpdate.activityPubActor["@context"];
      }
      if (accountToUpdate.activityPubActor.type) {
        (updateData.activityPubActor as Record<string, unknown>).type =
          accountToUpdate.activityPubActor.type;
      }
    }

    if (Object.keys(updateData).length === 0) {
      return c.json(
        { success: false, error: "更新するデータがありません" },
        400,
      );
    }

    const updatedAccount = await Account.findByIdAndUpdate(id, updateData, {
      new: true,
    });

    if (!updatedAccount) {
      return c.json(
        { success: false, error: "アカウントが見つかりません" },
        404,
      );
    }
    return c.json({ success: true, data: updatedAccount });
  } catch (error) {
    console.error("Account update error:", error);
    if ((error as { code?: number })?.code === 11000) {
      return c.json(
        { success: false, error: "その名前は既に使用されています" },
        409,
      );
    }
    return c.json(
      { success: false, error: "アカウント更新中にエラーが発生しました" },
      500,
    );
  }
});

// アカウント削除
app.delete("/:id", async (c) => {
  try {
    const { id } = c.req.param();
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return c.json({ success: false, error: "無効なID形式です" }, 400);
    }
    const deletedAccount = await Account.findByIdAndDelete(id);
    if (!deletedAccount) {
      return c.json(
        { success: false, error: "アカウントが見つかりません" },
        404,
      );
    }
    return c.json({ success: true, message: "アカウントを削除しました" });
  } catch (error) {
    console.error("Account deletion error:", error);
    return c.json(
      { success: false, error: "アカウント削除中にエラーが発生しました" },
      500,
    );
  }
});

export default app;
