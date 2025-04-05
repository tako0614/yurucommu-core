import { zValidator } from "@hono/zod-validator";
import { cache } from "hono/cache";
import { z } from "zod";
import { authorizationMiddleware, MyEnv } from "../../userInfo.ts";
import { Hono } from "hono";
import { Image } from "imagescript";
import { base64ToArrayBuffer } from "https://jsr.io/@takos/takos-encrypt-ink/5.3.2/utils/buffers.ts";
import { arrayBufferToBase64 } from "https://jsr.io/@takos/takos-encrypt-ink/6.0.2/utils/buffers.ts";
import { uuidv4 } from "npm:uuidv7@^1.0.2";
import { uploadFile } from "../../utils/S3Client.ts";
import {
  createTweet,
  createUserLike,
  createUserStory,
  removeUserLike,
} from "../../activityPub/mod.ts";
import { load } from "@std/dotenv";
import User from "../../models/users/users.ts";
import {
  LikeModel,
  MessageModel,
  StoryModel,
} from "../../activityPub/model.ts";
import Friend from "../../models/users/friends.ts";
import { checkImage, resizeImage } from "../../utils/ImageChecker.ts";
const env = await load();
const app = new Hono<MyEnv>();
app.use("*", authorizationMiddleware);

//route: /api/v2/sns/

/**
 * 新規投稿作成
 */
app.post(
  "/posts",
  zValidator(
    "json",
    z.object({
      text: z.string().min(1).max(256),
      media: z.array(z.string().min(1).max(1024 * 1024 * 15) // 10MB
      ).max(4).optional(),
    }),
  ),
  async (c) => {
    // ここに処理を書く
    const { text, media } = c.req.valid("json");
    const user = c.get("user");
    if (!user) {
      return c.json({ message: "Unauthorized" }, 401);
    }
    const images = [];
    for (const m of media || []) {
      // image/[jpeg, png, webp]のみ許可
      if (
        !m.startsWith("data:image/jpeg;base64,") &&
        !m.startsWith("data:image/png;base64,") &&
        !m.startsWith("data:image/webp;base64,")
      ) {
        return c.json({ message: "Invalid media type" }, 400);
      }
      const image = await resizeImageToNote(m);
      images.push(image);
    }
    const urls = [];
    for (const image of images) {
      // 画像をS3にアップロード
      const uuid = uuidv4();
      const key = `posts/${uuid}`;
      await uploadFile(key, image);
      urls.push(`https://${env["domain"]}/media/${uuid}`);
    }
    console.log(urls, "urls");
    // 投稿を作成
    const res = await createTweet({
      username: user.userName,
      content: text,
      mediaUrls: urls,
    });
    if (!res) {
      return c.json({ message: "Failed to create tweet" }, 500);
    }
    return c.json(200);
  },
);
export async function resizeImageToNote(
  imageBuffer: string,
): Promise<string> {
  if (await checkImage(imageBuffer, 1024, 1024)) {
    return imageBuffer;
  } else {
    const resizedImage = resizeImage(imageBuffer, 1024, 1024);
    return resizedImage;
  }
}

export async function resizeImageToStory(
  imageBuffer: string,
): Promise<string> {
  if (await checkImage(imageBuffer, 1024, 1024)) {
    return imageBuffer;
  } else {
    const resizedImage = resizeImage(imageBuffer, 1024, 1920);
    return resizedImage;
  }
}

/**
 * 投稿の取得
 */
app.get(
  "/posts/:userId/:postId",
  cache({ cacheName: "posts", cacheControl: "max-age=60" }),
  async (c) => {
    const postId = c.req.param("postId");
    const userId = c.req.param("userId");
    if (!postId || !userId) {
      return c.json({ message: "Invalid postId" }, 400);
    }
    const post = await MessageModel.findOne({
      id: `https://${env["domain"]}/u/${userId}/${postId}`,
    });
    if (!post) {
      return c.json({ message: "Post not found" }, 404);
    }
    return c.json(post);
  },
);

/**
 * 投稿の削除
 */
app.delete("/posts/:postId", async (c) => {
  const postId = c.req.param("postId");
  if (!postId) {
    return c.json({ message: "Invalid postId" }, 400);
  }

  const user = c.get("user");
  if (!user) {
    return c.json({ message: "Unauthorized" }, 401);
  }

  const post = await MessageModel
    .findOne({
      id: `https://${env["domain"]}/u/${user.userName}/${postId}`,
    });
  if (!post) {
    return c.json({ message: "Post not found" }, 404);
  }

  if (post.username !== user.userName) {
    return c.json({ message: "Unauthorized" }, 401);
  }
  await MessageModel.deleteOne({ id: post.id });
  return c.json(200);
});

/**
 * 投稿のいいね
 */
app.post("/posts/:userId/:postId/like", async (c) => {
  const postId = c.req.param("postId");
  const userId = c.req.param("userId");
  if (!postId || !userId) {
    return c.json({ message: "Invalid postId" }, 400);
  }
  const user = c.get("user");
  if (!user) {
    return c.json({ message: "Unauthorized" }, 401);
  }
  const post = await MessageModel.findOne({
    id: `https://${env["domain"]}/u/${userId}/${postId}`,
  });
  if (!post) {
    return c.json({ message: "Post not found" }, 404);
  }
  const res = await createUserLike({
    username: user.userName,
    targetId: post.id,
  });
  if (!res) {
    return c.json({ message: "Failed to like" }, 500);
  }
  return c.json(200);
});

/**
 * 投稿のいいねを解除
 */
app.delete("/posts/:userId/:postId/like", async (c) => {
  const postId = c.req.param("postId");
  const userId = c.req.param("userId");
  if (!postId || !userId) {
    return c.json({ message: "Invalid postId" }, 400);
  }
  const user = c.get("user");
  if (!user) {
    return c.json({ message: "Unauthorized" }, 401);
  }
  const post = await MessageModel.findOne({
    id: `https://${env["domain"]}/u/${userId}/${postId}`,
  });
  if (!post) {
    return c.json({ message: "Post not found" }, 404);
  }
  const likeId = await LikeModel.findOne({
    username: user.userName,
    targetId: post.id,
  });
  if (!likeId) {
    return c.json({ message: "Like not found" }, 404);
  }
  const res = await removeUserLike({
    username: user.userName,
    likeId: likeId.id,
  });
  if (!res) {
    return c.json({ message: "Failed to like" }, 500);
  }
  return c.json(200);
});
/**
 * ストーリー投稿
 */
app.post(
  "/stories",
  zValidator(
    "json",
    z.object({
      media: z.string().min(1).max(1024 * 1024 * 15), // 10MB
    }),
  ),
  async (c) => {
    const { media } = c.req.valid("json");
    const user = c.get("user");
    if (!user) {
      return c.json({ message: "Unauthorized" }, 401);
    }
    const resizedImage = await resizeImageToStory(media);
    const uuid = uuidv4();
    const key = `stories/${uuid}`;
    await uploadFile(key, resizedImage);
    const url = `https://${env["domain"]}/media/${uuid}`;
    // ストーリーを作成
    const res = await createUserStory({
      username: user.userName,
      mediaUrl: url,
      mediaType: "Image",
    });
    if (!res) {
      return c.json({ message: "Failed to create story" }, 500);
    }
    return c.json(200);
  },
);

app.get("/timeline", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ message: "Unauthorized" }, 401);
  }

  // フレンド（フォロー中ユーザー）のリストを取得
  const friends = await Friend.find({
    userName: user.userName + "@" + env["domain"],
  });

  // ローカルとリモートのユーザー情報を分離して準備
  const localUsernames = [user.userName];
  const remoteActors = [];

  // フレンドからローカル/リモートユーザーを分類
  for (const friend of friends) {
    // リモートユーザーの場合（actorプロパティがURL形式）
    if (friend.actor && friend.actor.startsWith("https://")) {
      remoteActors.push(friend.actor);
    } // ローカルユーザーの場合
    else if (friend.friendId) {
      // @がある場合はドメイン部分を取り除く
      const localName = friend.friendId.includes("@")
        ? friend.friendId.split("@")[0]
        : friend.friendId;
      localUsernames.push(localName);
    }
  }

  // ローカルとリモート両方の投稿を取得
  const localPosts = await MessageModel.find({
    username: { $in: localUsernames },
  });

  const remotePosts = await MessageModel.find({
    isRemote: true,
    actor: { $in: remoteActors },
  });

  // 重複を排除するために投稿IDをセットで管理
  const uniqueIds = new Set();
  const uniquePosts = [...localPosts, ...remotePosts].filter((post) => {
    // 初めて見るIDなら追加してtrueを返す、すでにあるなら除外(false)
    if (!uniqueIds.has(post.id)) {
      uniqueIds.add(post.id);
      return true;
    }
    return false;
  });

  // 重複排除後の投稿を時系列順にソート
  const allPosts = uniquePosts.sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  ).slice(0, 50); // 最新50件に制限

  // ストーリーも同様に取得
  const now = new Date();
  const stories = await StoryModel.find({
    $or: [
      { username: { $in: localUsernames }, expiresAt: { $gt: now } },
      {
        isRemote: true,
        actor: { $in: remoteActors },
        expiresAt: { $gt: now },
      },
    ],
  }).sort({ createdAt: -1 });

  // クライアント向けに整形
  const formattedPosts = await Promise.all(allPosts.map(async (post) => {
    // いいね数を取得
    const likesCount = await LikeModel.countDocuments({
      targetId: post.id,
    });
    const hasLiked = await LikeModel.findOne({
      username: user.userName,
      targetId: post.id,
    }) !== null;

    let userName, displayName, avatar = null, domain = env["domain"];

    // リモート投稿の場合はアクターURLからユーザー情報を抽出
    if (post.isRemote && post.actor) {
      try {
        const actorUrl = new URL(post.actor);
        domain = actorUrl.hostname;

        // アクターURLからユーザー名部分を抽出
        const pathParts = actorUrl.pathname.split("/").filter(Boolean);
        const remoteUsername = pathParts[pathParts.length - 1];

        userName = `${remoteUsername}@${domain}`;
        displayName = remoteUsername;
      } catch (error) {
        console.error("リモートユーザー情報の解析エラー:", error);
        userName = `unknown@${domain}`;
        displayName = "Unknown User";
      }
    } // ローカル投稿の場合
    else {
      try {
        const postUser = await User.findOne({
          userName: post.username,
        });
        userName = `${post.username}@${domain}`;
        displayName = postUser?.nickName || post.username;
        avatar = postUser?.icon || null;
      } catch (error) {
        userName = `${post.username}@${domain}`;
        displayName = post.username;
      }
    }

    return {
      id: post.id,
      content: post.body,
      createdAt: post.createdAt,
      media: post.attachment || [],
      author: {
        userName,
        domain, // ドメイン情報も明示的に含める
      },
      stats: {
        likes: likesCount,
        hasLiked,
      },
      isRemote: post.isRemote || false,
      originalId: post.originalId || null,
      url: post.url || null,
    };
  }));

  // ストーリーも同様にフォーマット
  const formattedStories = await Promise.all(stories.map(async (story) => {
    let userName, displayName, avatar = null, domain = env["domain"];

    // リモートストーリーの場合
    if (story.isRemote && story.actor) {
      try {
        const actorUrl = new URL(story.actor);
        domain = actorUrl.hostname;
      } catch (error) {
        userName = `unknown@${domain}`;
        displayName = "Unknown User";
      }
    } else {
      try {
        const storyUser = await User.findOne({
          userName: story.username,
        });
        userName = `${story.username}@${domain}`;
        displayName = storyUser?.nickName || story.username;
        avatar = storyUser?.icon || null;
      } catch (error) {
        userName = `${story.username}@${domain}`;
        displayName = story.username;
      }
    }

    return {
      id: story.id,
      mediaUrl: story.mediaUrl,
      mediaType: story.mediaType,
      createdAt: story.createdAt,
      expiresAt: story.expiresAt,
      author: {
        userName,
        displayName,
        avatar,
        domain,
      },
      viewed: story.viewers?.includes(user.userName) || false,
      isRemote: story.isRemote || false,
    };
  }));

  return c.json({
    posts: formattedPosts,
    stories: formattedStories,
  });
});

export default app;
