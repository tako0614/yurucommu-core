import { Hono } from "hono";
import {
  deleteObject,
  findObjects,
  getObject,
  saveObject,
  updateObject,
} from "./services/unified_store.ts";
import Account from "./models/account.ts";
import Group from "./models/group.ts";
import {
  createAcceptActivity,
  createBlockActivity,
  createObjectId,
  createRemoveActivity,
  deliverActivityPubObjectFromUrl,
  getDomain,
} from "./utils/activitypub.ts";
import authRequired from "./utils/auth.ts";

function bufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function bufferToPem(buffer: ArrayBuffer, type: "PUBLIC KEY" | "PRIVATE KEY") {
  const b64 = bufferToBase64(buffer);
  const lines = b64.match(/.{1,64}/g)?.join("\n") ?? b64;
  return `-----BEGIN ${type}-----\n${lines}\n-----END ${type}-----`;
}

async function generateKeyPair() {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSA-PSS",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const priv = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
  const pub = await crypto.subtle.exportKey("spki", keyPair.publicKey);
  return {
    privateKey: bufferToPem(priv, "PRIVATE KEY"),
    publicKey: bufferToPem(pub, "PUBLIC KEY"),
  };
}

const app = new Hono();
app.use("*", authRequired);

// コミュニティ一覧取得
app.get("/communities", async (c) => {
  try {
    const domain = getDomain(c);
    const communities = await Group.find().sort({ name: 1 }).lean();

    const formatted = await Promise.all(
      communities.map(async (community: Record<string, unknown>) => {
        const memberCount = Array.isArray(community.members)
          ? community.members.length
          : 0;
        const communityId = typeof community._id === "string"
          ? community._id
          : (community._id as { toString: () => string })?.toString() || "";
        const postCount = (
          await findObjects({
            type: "Note",
            "extra.communityId": communityId,
          })
        ).length;

        return {
          id: communityId,
          name: community.name,
          description: community.description,
          avatar: community.avatar || "",
          banner: community.banner || "",
          memberCount,
          postCount,
          isPrivate: community.isPrivate,
          tags: community.tags || [],
          rules: community.rules || [],
          createdAt: community.createdAt,
          moderators: community.moderators || [],
          domain,
        };
      }),
    );

    return c.json(formatted);
  } catch (error) {
    console.error("Error fetching communities:", error);
    return c.json({ error: "Failed to fetch communities" }, 500);
  }
});

// コミュニティ作成
app.post("/communities", async (c) => {
  try {
    const domain = getDomain(c);
    const { name, description, isPrivate, tags, avatar, banner } = await c.req
      .json();

    if (typeof name !== "string" || !name.trim()) {
      return c.json({ error: "Community name is required" }, 400);
    }

    // 同名のコミュニティが存在するかチェック
    const existingCommunity = await Group.findOne({ name });

    if (existingCommunity) {
      return c.json({ error: "Community with this name already exists" }, 409);
    }

    const keys = await generateKeyPair();

    const community = await Group.create({
      name,
      description: description || "",
      isPrivate: isPrivate || false,
      avatar: avatar || "",
      banner: banner || "",
      tags: tags || [],
      rules: [],
      members: [],
      moderators: [],
      banned: [],
      privateKey: keys.privateKey,
      publicKey: keys.publicKey,
    });

    return c.json({
      id: community._id.toString(),
      name,
      description: description || "",
      avatar: avatar || "",
      banner: banner || "",
      memberCount: 0,
      postCount: 0,
      isPrivate: isPrivate || false,
      tags: tags || [],
      rules: [],
      createdAt: community.createdAt,
      moderators: [],
      domain,
    }, 201);
  } catch (error) {
    console.error("Error creating community:", error);
    return c.json({ error: "Failed to create community" }, 500);
  }
});

// コミュニティ詳細取得
app.get("/communities/:id", async (c) => {
  try {
    const domain = getDomain(c);
    const id = c.req.param("id");
    const community = await Group.findById(id).lean();

    if (!community) {
      return c.json({ error: "Community not found" }, 404);
    }

    const members = community.members as string[] | undefined;
    const memberCount = members?.length || 0;
    const postCount = (
      await findObjects({ type: "Note", "extra.communityId": id })
    ).length;

    return c.json({
      id: community._id.toString(),
      name: community.name,
      description: community.description,
      avatar: community.avatar || "",
      banner: community.banner || "",
      memberCount,
      postCount,
      isPrivate: community.isPrivate,
      tags: community.tags || [],
      rules: community.rules || [],
      createdAt: community.createdAt,
      moderators: community.moderators || [],
      domain,
    });
  } catch (error) {
    console.error("Error fetching community:", error);
    return c.json({ error: "Failed to fetch community" }, 500);
  }
});

// コミュニティ参加
app.post("/communities/:id/join", async (c) => {
  try {
    const id = c.req.param("id");
    const { username } = await c.req.json();

    if (typeof username !== "string") {
      return c.json({ error: "Username is required" }, 400);
    }

    const community = await Group.findById(id);
    if (!community) {
      return c.json({ error: "Community not found" }, 404);
    }
    if (community.banned.includes(username)) {
      return c.json({ error: "Banned" }, 403);
    }
    const members = community.members as string[] || [];

    if (!members.includes(username)) {
      members.push(username);
      community.members = members;
      await community.save();
    }

    return c.json({ success: true, memberCount: members.length });
  } catch (error) {
    console.error("Error joining community:", error);
    return c.json({ error: "Failed to join community" }, 500);
  }
});

// コミュニティ退会
app.post("/communities/:id/leave", async (c) => {
  try {
    const id = c.req.param("id");
    const { username } = await c.req.json();

    if (typeof username !== "string") {
      return c.json({ error: "Username is required" }, 400);
    }

    const community = await Group.findById(id);
    if (!community) {
      return c.json({ error: "Community not found" }, 404);
    }

    const members = community.members as string[] || [];
    const updatedMembers = members.filter((member) => member !== username);

    community.members = updatedMembers;
    await community.save();

    return c.json({ success: true, memberCount: updatedMembers.length });
  } catch (error) {
    console.error("Error leaving community:", error);
    return c.json({ error: "Failed to leave community" }, 500);
  }
});

// コミュニティ投稿一覧取得
app.get("/communities/:id/posts", async (c) => {
  try {
    const domain = getDomain(c);
    const communityId = c.req.param("id");

    const posts = await findObjects({
      type: "Note",
      "extra.communityId": communityId,
    }, { published: -1 });

    const formatted = await Promise.all(
      posts.map(async (post: Record<string, unknown>) => {
        const account = await Account.findOne({ userName: post.attributedTo })
          .lean();

        const postId = typeof post._id === "string"
          ? post._id
          : (post._id as { toString: () => string })?.toString() || "";

        return {
          id: postId,
          communityId,
          content: post.content,
          userName: post.attributedTo,
          displayName: account?.displayName || post.attributedTo,
          authorAvatar: account?.avatarInitial || "",
          createdAt: post.published,
          likes: (post.extra as Record<string, unknown>)?.likes || 0,
          comments: (post.extra as Record<string, unknown>)?.comments || 0,
          isLiked: false, // TODO: ユーザーのいいね状態を取得
          isPinned: (post.extra as Record<string, unknown>)?.isPinned || false,
          domain,
        };
      }),
    );

    return c.json(formatted);
  } catch (error) {
    console.error("Error fetching community posts:", error);
    return c.json({ error: "Failed to fetch community posts" }, 500);
  }
});

// コミュニティ投稿作成
app.post("/communities/:id/posts", async (c) => {
  try {
    const domain = getDomain(c);
    const communityId = c.req.param("id");
    const { author, content } = await c.req.json();

    if (typeof author !== "string" || typeof content !== "string") {
      return c.json({ error: "Invalid body" }, 400);
    }

    // コミュニティが存在するかチェック
    const community = await Group.findById(communityId);
    if (!community) {
      return c.json({ error: "Community not found" }, 404);
    }

    const post = await saveObject(c.get("env") as Record<string, string>, {
      _id: createObjectId(domain),
      type: "Note",
      attributedTo: author,
      content,
      extra: {
        communityId,
        likes: 0,
        comments: 0,
        isPinned: false,
      },
      actor_id: `https://${domain}/users/${author}`,
      aud: { to: ["https://www.w3.org/ns/activitystreams#Public"], cc: [] },
    });

    const account = await Account.findOne({ userName: author }).lean();

    return c.json({
      id: post._id.toString(),
      communityId,
      content: post.content,
      userName: post.attributedTo,
      displayName: account?.displayName || post.attributedTo,
      authorAvatar: account?.avatarInitial || "",
      createdAt: post.published,
      likes: 0,
      comments: 0,
      isLiked: false,
      isPinned: false,
      domain,
    }, 201);
  } catch (error) {
    console.error("Error creating community post:", error);
    return c.json({ error: "Failed to create community post" }, 500);
  }
});

// コミュニティ投稿いいね
app.post("/communities/:communityId/posts/:postId/like", async (c) => {
  try {
    const postId = c.req.param("postId");

    const post = await updateObject(postId, { $inc: { "extra.likes": 1 } });

    if (!post || post.type !== "Note") {
      return c.json({ error: "Post not found" }, 404);
    }

    return c.json({
      likes: (post.extra as Record<string, unknown>)?.likes || 0,
    });
  } catch (error) {
    console.error("Error liking community post:", error);
    return c.json({ error: "Failed to like post" }, 500);
  }
});

// コミュニティ投稿削除（モデレーター専用）
app.post("/communities/:communityId/posts/:postId/remove", async (c) => {
  try {
    const domain = getDomain(c);
    const communityId = c.req.param("communityId");
    const postId = c.req.param("postId");
    const { username } = await c.req.json();

    if (typeof username !== "string") {
      return c.json({ error: "Username is required" }, 400);
    }

    const community = await Group.findById(communityId);
    if (!community) return c.json({ error: "Community not found" }, 404);

    if (!community.moderators.includes(username)) {
      return c.json({ error: "Forbidden" }, 403);
    }

    const post = await getObject(postId);
    if (!post) return c.json({ error: "Post not found" }, 404);

    await deleteObject(postId);

    const objectUrl = typeof post.raw?.id === "string"
      ? post.raw.id as string
      : `https://${domain}/objects/${post._id}`;

    const remove = createRemoveActivity(
      domain,
      `https://${domain}/communities/${community.name}`,
      objectUrl,
    );
    deliverActivityPubObjectFromUrl(
      community.followers,
      remove,
      {
        id: `https://${domain}/communities/${community.name}`,
        privateKey: community.privateKey,
      },
    ).catch((err) => {
      console.error("Delivery failed:", err);
    });

    return c.json({ success: true });
  } catch (error) {
    console.error("Error removing community post:", error);
    return c.json({ error: "Failed to remove post" }, 500);
  }
});

// 未承認フォロワー一覧取得
app.get("/communities/:id/pending-followers", async (c) => {
  try {
    const id = c.req.param("id");
    const community = await Group.findById(id).lean();
    if (!community) return c.json({ error: "Community not found" }, 404);
    return c.json({ pending: community.pendingFollowers || [] });
  } catch (error) {
    console.error("Error fetching pending followers:", error);
    return c.json({ error: "Failed" }, 500);
  }
});

// フォロワー承認
app.post("/communities/:id/pending-followers/approve", async (c) => {
  try {
    const domain = getDomain(c);
    const id = c.req.param("id");
    const { username, actor } = await c.req.json();
    if (typeof username !== "string" || typeof actor !== "string") {
      return c.json({ error: "Invalid body" }, 400);
    }
    const community = await Group.findById(id);
    if (!community) return c.json({ error: "Community not found" }, 404);
    if (!community.moderators.includes(username)) {
      return c.json({ error: "Forbidden" }, 403);
    }
    if (!community.pendingFollowers.includes(actor)) {
      return c.json({ error: "Not found" }, 404);
    }
    community.pendingFollowers = community.pendingFollowers.filter((a) =>
      a !== actor
    );
    community.followers.push(actor);
    await community.save();
    const accept = createAcceptActivity(
      domain,
      `https://${domain}/communities/${community.name}`,
      {
        type: "Follow",
        actor,
        object: `https://${domain}/communities/${community.name}`,
      },
    );
    await deliverActivityPubObjectFromUrl(
      [actor],
      accept,
      {
        id: `https://${domain}/communities/${community.name}`,
        privateKey: community.privateKey,
      },
    );
    return c.json({ success: true });
  } catch (error) {
    console.error("Error approving follower:", error);
    return c.json({ error: "Failed" }, 500);
  }
});

// フォロワー拒否
app.post("/communities/:id/pending-followers/reject", async (c) => {
  try {
    const id = c.req.param("id");
    const { username, actor } = await c.req.json();
    if (typeof username !== "string" || typeof actor !== "string") {
      return c.json({ error: "Invalid body" }, 400);
    }
    const community = await Group.findById(id);
    if (!community) return c.json({ error: "Community not found" }, 404);
    if (!community.moderators.includes(username)) {
      return c.json({ error: "Forbidden" }, 403);
    }
    community.pendingFollowers = community.pendingFollowers.filter((a) =>
      a !== actor
    );
    await community.save();
    return c.json({ success: true });
  } catch (error) {
    console.error("Error rejecting follower:", error);
    return c.json({ error: "Failed" }, 500);
  }
});

// ユーザーBAN（モデレーター専用）
app.post("/communities/:id/block", async (c) => {
  try {
    const domain = getDomain(c);
    const id = c.req.param("id");
    const { username, target } = await c.req.json();

    if (typeof username !== "string" || typeof target !== "string") {
      return c.json({ error: "Invalid body" }, 400);
    }

    const community = await Group.findById(id);
    if (!community) return c.json({ error: "Community not found" }, 404);

    if (!community.moderators.includes(username)) {
      return c.json({ error: "Forbidden" }, 403);
    }

    if (!community.banned.includes(target)) {
      community.banned.push(target);
    }
    community.followers = community.followers.filter((f) => f !== target);
    community.members = community.members.filter((m) => m !== target);
    await community.save();

    const block = createBlockActivity(
      domain,
      `https://${domain}/communities/${community.name}`,
      target,
    );
    deliverActivityPubObjectFromUrl(
      [target],
      block,
      {
        id: `https://${domain}/communities/${community.name}`,
        privateKey: community.privateKey,
      },
    ).catch((err) => {
      console.error("Delivery failed:", err);
    });

    return c.json({ success: true });
  } catch (error) {
    console.error("Error blocking user:", error);
    return c.json({ error: "Failed to block user" }, 500);
  }
});

export default app;
