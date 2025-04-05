import friends from "../models/users/friends.ts";
import User from "../models/users/users.ts";
import {
  createLike,
  createNote,
  createStory,
  getInbox,
  undoLike,
} from "./logic.ts";
import { LikeModel, MessageModel, StoryModel } from "./model.ts";
import { importprivateKey } from "./utils.ts";
import { load } from "@std/dotenv";

const env = await load();

export async function createTweet(
  { username, content, mediaUrls }: {
    username: string;
    content: string;
    mediaUrls: string[];
  },
) {
  try {
    // 入力バリデーション
    if (!username || !content) {
      return null;
    }

    // ユーザー情報取得
    const user = await User.findOne({ userName: username });
    if (!user) {
      return null;
    }
    // ノートIDを生成
    const noteId = crypto.randomUUID();
    // ローカルデータベースに保存
    const newNote = new MessageModel({
      id: `https://${env["domain"]}/u/${username}/s/${noteId}`,
      username,
      body: content, // contentではなくbodyを使用
      createdAt: new Date(),
      attachment: mediaUrls.map((mediaUrl) => ({
        type: "Image",
        url: mediaUrl,
      })),
    });
    await newNote.save();
    // フォロワーにノートを配信（非同期実行が望ましい）
    if (user.privateKey) {
      const privateKey = await importprivateKey(user.privateKey);
      // フォロワー取得
      const followers = await friends.find({
        userName: username + "@" + env["domain"],
      });
      console.log("followers", followers);
      for (const follower of followers) {
        try {
          // フォロワーのActorオブジェクトを取得
          if (!follower.actor) continue;
          const actorInfo = await getInbox(follower.actor);
          console.log("actorInfo", actorInfo);
          // フォロワーにノートを配信
          await createNote(
            noteId,
            username,
            env["domain"],
            actorInfo,
            content,
            privateKey,
            mediaUrls.map((mediaUrl) => ({
              type: "Image",
              url: mediaUrl,
            })),
          );
        } catch (err) {
          console.error(
            `フォロワー ${follower} への配信に失敗: ${err}`,
          );
          // 個別のエラーはスキップして次のフォロワーに進む
        }
      }
    }

    return newNote;
  } catch (error) {
    console.error(`ノートの作成に失敗: ${error}`);
    return null;
  }
}

// ストーリー作成関数の追加
export async function createUserStory(
  { username, mediaUrl, mediaType }: {
    username: string;
    mediaUrl: string;
    mediaType: string;
  },
) {
  try {
    // 入力バリデーション - コンテンツかメディアのどちらかは必須
    if (!username || !mediaUrl) {
      return {
        success: false,
        error: "コンテンツまたはメディアが必要です",
      };
    }

    // ユーザー情報取得
    const user = await User.findOne({ userName: username });
    if (!user) {
      return { success: false, error: "ユーザーが見つかりません" };
    }

    // ストーリーIDを生成
    const storyId = crypto.randomUUID();

    // 有効期限を24時間後に設定
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    // ローカルデータベースに保存
    const newStory = new StoryModel({
      id: `https://${env["domain"]}/u/${username}/story/${storyId}`,
      username,
      mediaUrl: mediaUrl || null,
      mediaType: mediaType || null,
      createdAt: new Date(),
      expiresAt: expiresAt,
      isRemote: false,
    });
    await newStory.save();

    // フォロワーにストーリーを配信
    if (user.privateKey) {
      const privateKey = await importprivateKey(user.privateKey);
      // フォロワー取得
      const followers = await friends.find({ userName: username });

      // フォロワーそれぞれにストーリーを配信
      for (const follower of followers) {
        try {
          // フォロワーのActorオブジェクトを取得
          if (!follower.actor) continue;
          const actorInfo = await getInbox(follower.actor);

          // フォロワーにストーリーを配信
          await createStory(
            storyId,
            username,
            env["domain"],
            actorInfo,
            mediaUrl || null,
            mediaType || null,
            expiresAt.toISOString(),
            privateKey,
          );
        } catch (err) {
          console.error(
            `フォロワー ${follower.userName} へのストーリー配信に失敗: ${err}`,
          );
        }
      }
    }

    return { success: true, story: newStory };
  } catch (error) {
    console.error(`ストーリーの作成に失敗: ${error}`);
    return { success: false, error: "内部エラー" };
  }
}

export async function createUserLike(
  { username, targetId }: { username: string; targetId: string },
) {
  try {
    // 入力バリデーション
    if (!username || !targetId) {
      return null;
    }

    // ユーザー情報取得
    const user = await User.findOne({ userName: username });
    if (!user) {
      return null;
    }

    // 対象の投稿を確認
    const post = await MessageModel.findOne({ id: targetId });
    if (!post) {
      return null;
    }

    // 既にいいねしていないか確認
    const existingLike = await LikeModel.findOne({
      username,
      targetId,
      isRemote: false,
    });

    if (existingLike) {
      return null;
    }

    // いいねIDを生成
    const likeId = crypto.randomUUID();

    // ローカルデータベースに保存
    const newLike = new LikeModel({
      id: `https://${env["domain"]}/u/${username}/like/${likeId}`,
      username,
      targetId,
      actor: `https://${env["domain"]}/u/${username}`,
      createdAt: new Date(),
      isRemote: false,
    });
    await newLike.save();

    // リモート投稿の場合は相手にいいねを通知
    if (post.isRemote && post.actor && user.privateKey) {
      const privateKey = await importprivateKey(user.privateKey);
      const actorInfo = await getInbox(post.actor);

      if (actorInfo) {
        await createLike(
          likeId,
          username,
          env["domain"],
          actorInfo,
          post.originalId || post.id,
          privateKey,
        );
      }
    }

    return newLike;
  } catch (error) {
    console.error(`いいねの作成に失敗: ${error}`);
    return null;
  }
}

export async function removeUserLike(
  { username, likeId }: { username: string; likeId: string },
) {
  try {
    // いいね情報を取得
    const like = await LikeModel.findOne({ id: likeId });
    if (!like) {
      return 1;
    }

    // ユーザー権限チェック
    if (
      like.username !== username &&
      like.actor !== `https://${env["domain"]}/u/${username}`
    ) {
      return 2;
    }

    // ユーザー情報取得
    const user = await User.findOne({ userName: username });
    if (!user) {
      return 3;
    }

    // いいねを削除
    await LikeModel.deleteOne({ id: likeId });

    // リモート投稿へのいいねだった場合、Undoを送信
    const post = await MessageModel.findOne({ id: like.targetId });
    if (post && post.isRemote && post.actor && user.privateKey) {
      const privateKey = await importprivateKey(user.privateKey);
      const actorInfo = await getInbox(post.actor);

      if (actorInfo) {
        const undoId = crypto.randomUUID();
        await undoLike(
          undoId,
          username,
          env["domain"],
          actorInfo,
          like.id,
          post.originalId || post.id,
          privateKey,
        );
      }
    }

    return { success: true };
  } catch (error) {
    console.error(`いいねの取り消しに失敗: ${error}`);
    return 4;
  }
}
