import { Hono } from "hono";
import ActivityPubObject from "./models/activitypub_object.ts";
import Account from "./models/account.ts";
import { getDomain } from "./utils/activitypub.ts";

const app = new Hono();

// コミュニティ一覧取得
app.get("/communities", async (c) => {
  try {
    const domain = getDomain(c);
    const communities = await ActivityPubObject.find({
      type: "Community",
    }).sort({ published: -1 }).lean();

    const formatted = await Promise.all(
      communities.map(async (community: Record<string, unknown>) => {
        // メンバー数とポスト数を計算
        const extra = community.extra as Record<string, unknown>;
        const members = extra?.members as string[] | undefined;
        const memberCount = members?.length || 0;
        const communityId = typeof community._id === "string"
          ? community._id
          : (community._id as { toString: () => string })?.toString() || "";
        const postCount = await ActivityPubObject.countDocuments({
          type: "CommunityPost",
          "extra.communityId": communityId,
        });

        return {
          id: communityId,
          name: (community.extra as Record<string, unknown>)?.name || "",
          description: community.content || "",
          avatar: (community.extra as Record<string, unknown>)?.avatar || "",
          banner: (community.extra as Record<string, unknown>)?.banner || "",
          memberCount,
          postCount,
          isPrivate: (community.extra as Record<string, unknown>)?.isPrivate ||
            false,
          tags: (community.extra as Record<string, unknown>)?.tags || [],
          rules: (community.extra as Record<string, unknown>)?.rules || [],
          createdAt: community.published,
          moderators:
            (community.extra as Record<string, unknown>)?.moderators || [],
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
    const existingCommunity = await ActivityPubObject.findOne({
      type: "Community",
      "extra.name": name,
    });

    if (existingCommunity) {
      return c.json({ error: "Community with this name already exists" }, 409);
    }

    const community = new ActivityPubObject({
      type: "Community",
      attributedTo: "system", // システムが作成
      content: description || "",
      extra: {
        name,
        avatar: avatar || "",
        banner: banner || "",
        isPrivate: isPrivate || false,
        tags: tags || [],
        rules: [],
        members: [],
        moderators: [],
      },
    });

    await community.save();

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
      createdAt: community.published,
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
    const community = await ActivityPubObject.findById(id).lean();

    if (!community || community.type !== "Community") {
      return c.json({ error: "Community not found" }, 404);
    }

    const extra = community.extra as Record<string, unknown>;
    const members = extra?.members as string[] | undefined;
    const memberCount = members?.length || 0;
    const postCount = await ActivityPubObject.countDocuments({
      type: "CommunityPost",
      "extra.communityId": id,
    });

    return c.json({
      id: community._id.toString(),
      name: (community.extra as Record<string, unknown>)?.name || "",
      description: community.content || "",
      avatar: (community.extra as Record<string, unknown>)?.avatar || "",
      banner: (community.extra as Record<string, unknown>)?.banner || "",
      memberCount,
      postCount,
      isPrivate: (community.extra as Record<string, unknown>)?.isPrivate ||
        false,
      tags: (community.extra as Record<string, unknown>)?.tags || [],
      rules: (community.extra as Record<string, unknown>)?.rules || [],
      createdAt: community.published,
      moderators: (community.extra as Record<string, unknown>)?.moderators ||
        [],
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

    const community = await ActivityPubObject.findById(id);
    if (!community || community.type !== "Community") {
      return c.json({ error: "Community not found" }, 404);
    }

    const extra = community.extra as Record<string, unknown>;
    const members = (extra.members as string[]) || [];

    if (!members.includes(username)) {
      members.push(username);
      extra.members = members;
      community.extra = extra;
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

    const community = await ActivityPubObject.findById(id);
    if (!community || community.type !== "Community") {
      return c.json({ error: "Community not found" }, 404);
    }

    const extra = community.extra as Record<string, unknown>;
    const members = (extra.members as string[]) || [];
    const updatedMembers = members.filter((member) => member !== username);

    extra.members = updatedMembers;
    community.extra = extra;
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

    const posts = await ActivityPubObject.find({
      type: "CommunityPost",
      "extra.communityId": communityId,
    }).sort({ published: -1 }).lean();

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
    const community = await ActivityPubObject.findById(communityId);
    if (!community || community.type !== "Community") {
      return c.json({ error: "Community not found" }, 404);
    }

    const post = new ActivityPubObject({
      type: "CommunityPost",
      attributedTo: author,
      content,
      extra: {
        communityId,
        likes: 0,
        comments: 0,
        isPinned: false,
      },
    });

    await post.save();

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

    const post = await ActivityPubObject.findByIdAndUpdate(postId, {
      $inc: { "extra.likes": 1 },
    }, { new: true });

    if (!post || post.type !== "CommunityPost") {
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

export default app;
