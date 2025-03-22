import { Hono } from "hono";
import {
    exportPublicKey,
    importprivateKey,
    privateKeyToPublicKey,
} from "./utils.ts";
import { LikeModel, MessageModel, StoryModel } from "./model.ts";
import { getInbox } from "./logic.ts";
import { nanoid } from "nanoid";
import User from "../models/users/users.ts";
import { load } from "@std/dotenv";
const env = await load();
const strHost = env["domain"];
const app = new Hono();

app.get(":strName", async (c) => {
    const strName = c.req.param("strName");
    const user = await User.findOne({ userName: strName });
    if (!user) return c.notFound();
    if (!c.req.header("Accept")?.includes("application/activity+json")) {
        return c.text(`${strName}: ${user.userName}`);
    }
    const PRIVATE_KEY = await importprivateKey(user.privateKey!);
    const PUBLIC_KEY = await privateKeyToPublicKey(PRIVATE_KEY);
    const public_key_pem = await exportPublicKey(PUBLIC_KEY);
    // アイコン設定
    let iconConfig;
    if (user.icon) {
        // base64エンコードされたデータがある場合はそれを使用
        iconConfig = {
            type: "Image",
            mediaType: "image/png", // 画像タイプはpngと仮定
            url: `https://${strHost}/static/icon.png`,
        };
    } else {
        // ない場合はデフォルトアイコンを使用
        iconConfig = {
            type: "Image",
            mediaType: "image/png",
            url: `https://${strHost}/static/icon.png`,
        };
    }

    const r = {
        "@context": [
            "https://www.w3.org/ns/activitystreams",
            "https://w3id.org/security/v1",
            {
                toot: "http://joinmastodon.org/ns#",
                featured: {
                    "@id": "toot:featured",
                    "@type": "@id",
                },
                discoverable: "toot:discoverable",
            },
        ],
        id: `https://${strHost}/u/${strName}`,
        type: "Person",
        inbox: `https://${strHost}/u/${strName}/inbox`,
        outbox: `https://${strHost}/u/${strName}/outbox`, // 追加: outboxは必須
        followers: `https://${strHost}/u/${strName}/followers`,
        preferredUsername: strName,
        name: user.nickName || strName,
        summary: "", // 追加: 自己紹介（空でも可）
        url: `https://${strHost}/u/${strName}`,
        discoverable: true, // 追加: 検索可能フラグ
        publicKey: {
            id: `https://${strHost}/u/${strName}#main-key`, // キーIDを修正
            type: "Key",
            owner: `https://${strHost}/u/${strName}`,
            publicKeyPem: public_key_pem,
        },
        icon: iconConfig,
        published: new Date().toISOString(), // 追加: アカウント作成日
        manuallyApprovesFollowers: false, // 追加: フォロー承認不要
        attachment: [], // 追加: プロフィールメタデータ
        endpoints: {
            sharedInbox: `https://${strHost}/inbox`, // 追加: 共有インボックス
        },
    };

    // CORSヘッダーの追加
    return c.json(r, 200, {
        "Content-Type": "application/activity+json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=60",
    });
});

// outboxエンドポイントを追加
app.get(":strName/outbox", async (c) => {
    const strName = c.req.param("strName");

    // ユーザー存在確認
    const user = await User.findOne({ userName: strName });
    if (!user) return c.notFound();

    if (!c.req.header("Accept")?.includes("application/activity+json")) {
        return c.body(null, 400);
    }

    // 空のOrderedCollectionを返す（最小限の実装）
    const r = {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: `https://${strHost}/u/${strName}/outbox`,
        type: "OrderedCollection",
        totalItems: 0,
        first: {
            id: `https://${strHost}/u/${strName}/outbox?page=1`,
            type: "OrderedCollectionPage",
            next: `https://${strHost}/u/${strName}/outbox?page=2`,
            partOf: `https://${strHost}/u/${strName}/outbox`,
            orderedItems: [],
        },
    };

    return c.json(r, 200, {
        "Content-Type": "application/activity+json",
        "Access-Control-Allow-Origin": "*",
    });
});

// 投稿取得エンドポイントを追加
app.get(":strName/s/:noteId", async (c) => {
    const strName = c.req.param("strName");
    const noteId = c.req.param("noteId");
    const user = await User.findOne({ userName: strName });
    if (!user) return c.notFound();

    // 投稿を検索
    const message = await MessageModel.findOne({
        $or: [
            { id: noteId },
            { id: `https://${strHost}/u/${strName}/s/${noteId}` },
        ],
    });

    if (!message) {
        console.log(`投稿が見つかりません: ${noteId}`);
        return c.notFound();
    }

    // Accept ヘッダーチェック
    if (!c.req.header("Accept")?.includes("application/activity+json")) {
        // HTML形式での表示
        return c.html(`<html><head><title>投稿 - ${strName}</title></head>
      <body>
        <h1>${user.userName}(${user.nickName})さんの投稿</h1>
        <p>${message.body}</p>
        <p><small>${new Date(message.createdAt).toLocaleString()}</small></p>
      </body></html>`);
    }

    // ActivityPub形式のレスポンス
    const note = {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: `https://${strHost}/u/${strName}/s/${noteId}`,
        type: "Note",
        published: new Date(message.createdAt).toISOString(),
        attributedTo: `https://${strHost}/u/${strName}`,
        content: message.body,
        to: ["https://www.w3.org/ns/activitystreams#Public"],
        cc: [`https://${strHost}/u/${strName}/followers`],
        attachment: message.attachment,
    };

    return c.json(note, 200, {
        "Content-Type": "application/activity+json",
        "Access-Control-Allow-Origin": "*",
    });
});

export interface ActivityPubObject {
    id: string; // オブジェクトの一意のURI
    type: string; // オブジェクトの種類
    published?: string; // ISO 8601形式の公開日時
    updated?: string; // 更新日時
    attributedTo?: string; // 作成者のURI
    content?: string; // コンテンツ
    name?: string; // 名前/タイトル
    summary?: string; // 概要
    url?: string | string[]; // 関連URL
    to?: string[]; // 受信者リスト
    cc?: string[]; // カーボンコピー受信者
    [key: string]: any; // その他の拡張フィールド
}

export interface Story extends ActivityPubObject {
    id: string; // ストーリーのURI
    type: "Story";
    attributedTo: string; // 作成者のURIを示す
    mediaType: string; // コンテンツのメディアタイプ
    url: string; // 画像・動画のURL
    expiresAt: string; // 有効期限（ISO 8601形式の日時）
}

app.get("/:strName/inbox", (c) => c.body(null, 405));
app.post("/:strName/inbox", async (c) => {
    const strName = c.req.param("strName");
    // ユーザー存在確認
    const user = await User.findOne({ userName: strName });
    if (!user) return c.notFound();
    if (!c.req.header("Content-Type")?.includes("application/activity+json")) {
        return c.body(null, 400);
    }
    const y = await c.req.json<any>();
    if (new URL(y.actor).protocol !== "https:") return c.body(null, 400);
    const x = await getInbox(y.actor);
    if (!x) return c.body(null, 500);

    if (y.type === "Create" && y.object?.type === "Note") {
        const note = y.object;
        const content = note.content || "";
        // HTMLタグを取り除き、プレーンテキストを抽出
        const strippedContent = content.replace(/<[^>]*>?/gm, "");
        console.log("新しい投稿を受信:", note);
        await MessageModel.create({
            id: nanoid(),
            username: strName, // 受信したユーザー名
            body: strippedContent,
            createdAt: new Date(note.published || Date.now()),
            actor: y.actor,
            originalId: note.id,
            isRemote: true,
            url: note.url || note.id,
            attachment: note.attachment,
        });
        return c.body(null, 202);
    }

    if (y.type === "Create" && y.object?.type === "Story") {
        const story = y.object as Story;

        // メディア添付があるかチェック
        let mediaUrl = null;
        let mediaType = null;

        if (story.mediaType && story.url) {
            mediaUrl = story.url;
            mediaType = story.mediaType;
        } else {
            console.log("メディア添付がありません");
            return c.body(null, 400);
        }

        // 有効期限のチェック
        const expiresAt = story.expiresAt
            ? new Date(story.expiresAt)
            : new Date();
        if (!story.expiresAt) {
            expiresAt.setHours(expiresAt.getHours() + 24); // デフォルトは24時間
        }

        // ストーリーを保存
        await StoryModel.create({
            id: nanoid(),
            username: strName, // 受信したユーザー名
            mediaUrl,
            mediaType,
            createdAt: new Date(story.published || Date.now()),
            expiresAt,
            actor: y.actor,
            originalId: story.id,
            isRemote: true,
            url: story.url || story.id,
        });

        return c.body(null, 202);
    }

    if (y.type === "Delete" && y.object?.type === "Note") {
        // 削除対象の投稿IDを取得
        const noteId = y.object.id;
        // データベースから削除
        await MessageModel.deleteOne({ originalId: noteId });
        return c.body(null, 202);
    }

    // いいねを受信した場合の処理
    if (y.type === "Like") {
        const targetId = y.object;

        // 対象の投稿が存在するか確認
        const post = await MessageModel.findOne({
            $or: [
                { id: targetId },
                { originalId: targetId },
            ],
        });

        if (!post) {
            console.log("いいねされた投稿が見つかりません:", targetId);
            return c.body(null, 400);
        }

        // いいねを保存
        await LikeModel.create({
            id: y.id || nanoid(),
            username: strName, // いいねされた投稿の所有者
            targetId: post.id, // ローカルの投稿ID
            actor: y.actor,
            createdAt: new Date(),
            isRemote: true,
        });

        return c.body(null, 202);
    }

    // いいねの取り消しを受信した場合の処理
    if (y.type === "Undo" && y.object?.type === "Like") {
        const like = y.object;
        const targetId = like.object;

        // いいねを削除
        await LikeModel.deleteOne({
            actor: y.actor,
            $or: [
                { targetId: targetId },
                {
                    targetId: {
                        $regex: new RegExp(
                            targetId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
                                "$",
                        ),
                    },
                },
            ],
        });

        return c.body(null, 202);
    }

    console.log("未対応のアクティビティタイプ:", y.type);
    return c.body(null, 500);
});

// ストーリー取得エンドポイントを追加
app.get(":strName/story/:storyId", async (c) => {
    const strName = c.req.param("strName");
    const storyId = c.req.param("storyId");

    // ユーザー存在確認
    const user = await User.findOne({ userName: strName });
    if (!user) return c.notFound();

    // ストーリーを検索
    const story = await StoryModel.findOne({
        $or: [
            { id: storyId },
            { id: `https://${strHost}/u/${strName}/story/${storyId}` },
        ],
    });

    if (!story) {
        return c.notFound();
    }

    // 有効期限チェック
    if (story.expiresAt && story.expiresAt < new Date()) {
        return c.body("このストーリーは有効期限切れです", 410);
    }

    // Accept ヘッダーチェック
    if (!c.req.header("Accept")?.includes("application/activity+json")) {
        // HTML形式での表示
        let mediaHtml = "";
        if (story.mediaUrl) {
            if (story.mediaType?.startsWith("image/")) {
                mediaHtml =
                    `<img src="${story.mediaUrl}" alt="ストーリー画像" style="max-width: 100%;">`;
            } else if (story.mediaType?.startsWith("video/")) {
                mediaHtml =
                    `<video controls style="max-width: 100%;"><source src="${story.mediaUrl}" type="${story.mediaType}">お使いのブラウザはビデオをサポートしていません</video>`;
            }
        }

        return c.html(`<html><head><title>ストーリー - ${strName}</title></head>
      <body>
        <h1>${user.userName}(${user.nickName})さんのストーリー</h1>
        ${mediaHtml}
        <p><small>投稿: ${
            new Date(story.createdAt).toLocaleString()
        }</small></p>
        <p><small>有効期限: ${
            new Date(story.expiresAt).toLocaleString()
        }</small></p>
      </body></html>`);
    }

    // ActivityPub形式のレスポンス
    const storyResponse: Story = {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: story.id,
        type: "Story",
        published: story.createdAt.toISOString(),
        attributedTo: `https://${strHost}/u/${strName}`,
        expiresAt: story.expiresAt.toISOString(),
        to: [`https://${strHost}/u/${strName}/followers`],
        cc: [],
        url: story.url,
        mediaType: story.mediaType || "",
    };

    if (story.mediaUrl && story.mediaType) {
        storyResponse.url = story.mediaUrl;
        storyResponse.mediaType = story.mediaType;
        storyResponse.attachment = [
            {
                type: "Document",
                mediaType: story.mediaType,
                url: story.mediaUrl,
            },
        ];
    }

    return c.json(storyResponse, 200, {
        "Content-Type": "application/activity+json",
        "Access-Control-Allow-Origin": "*",
    });
});

export default app;
