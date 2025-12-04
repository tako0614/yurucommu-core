/**
 * App Main - Core Kernel Services への接続
 *
 * PLAN.md 5.4 に基づく App Layer のメインモジュール
 * プレースホルダから実装に移行し、Core Kernel サービス API を通じてコア機能を提供
 *
 * このファイルは Manifest routing が有効な場合に handler として呼び出される
 */

import type { AppHandler, TakosContext, AppAuthContext } from "@takos/platform/app";
import type { CoreServices } from "@takos/platform/app/services";

// Helper: require authentication
function requireAuth(ctx: TakosContext): AppAuthContext & { userId: string } {
  if (!ctx.auth?.userId) {
    throw { type: "error", status: 401, message: "authentication required" };
  }
  return ctx.auth as AppAuthContext & { userId: string };
}

// Helper: get services with type safety
function getServices(ctx: TakosContext): CoreServices {
  return ctx.services as unknown as CoreServices;
}

// Helper: parse input with defaults
function parseInput<T>(input: unknown, defaults: T): T {
  if (!input || typeof input !== "object") return defaults;
  return { ...defaults, ...(input as object) } as T;
}

// ============================================================================
// Authentication Handlers
// ============================================================================

export const authLogin: AppHandler = async (ctx, input) => {
  ctx.log("info", "authLogin handler invoked", { input: !!input });
  // Auth login is handled by Core Kernel directly - this is a pass-through
  return ctx.error("Auth login should be handled by Core Kernel /-/auth routes", 501);
};

export const issueSessionToken: AppHandler = async (ctx, input) => {
  ctx.log("info", "issueSessionToken handler invoked");
  return ctx.error("Session token issuance should be handled by Core Kernel", 501);
};

export const logout: AppHandler = async (ctx, input) => {
  ctx.log("info", "logout handler invoked");
  return ctx.error("Logout should be handled by Core Kernel", 501);
};

export const ownerActors: AppHandler = async (ctx, input) => {
  ctx.log("info", "ownerActors handler invoked");
  return ctx.error("Owner actors management should be handled by Core Kernel", 501);
};

// ============================================================================
// User Handlers
// ============================================================================

export const getCurrentUser: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  const services = getServices(ctx);
  ctx.log("info", "getCurrentUser", { userId: auth.userId });

  const user = await services.users.getUser(auth, auth.userId);
  if (!user) {
    return ctx.error("User not found", 404);
  }
  return ctx.json(user);
};

export const updateProfile: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  ctx.log("info", "updateProfile", { userId: auth.userId });
  const services = getServices(ctx);
  const payload = parseInput(input, {
    display_name: undefined as string | undefined,
    avatar: undefined as string | undefined,
    bio: undefined as string | undefined,
    is_private: undefined as boolean | undefined,
  });
  const user = await services.users.updateProfile(auth, payload);
  return ctx.json(user);
};

export const searchUsers: AppHandler = async (ctx, input) => {
  const auth = ctx.auth ?? { userId: null };
  const services = getServices(ctx);
  const params = parseInput(input, { query: "", limit: 20, offset: 0 });
  ctx.log("info", "searchUsers", { query: params.query });

  const result = await services.users.searchUsers(auth as AppAuthContext, params);
  return ctx.json(result);
};

export const getUser: AppHandler = async (ctx, input) => {
  const auth = ctx.auth ?? { userId: null };
  const services = getServices(ctx);
  const { id } = parseInput(input, { id: "" });
  ctx.log("info", "getUser", { id });

  if (!id) {
    return ctx.error("User ID is required", 400);
  }
  const user = await services.users.getUser(auth as AppAuthContext, id);
  if (!user) {
    return ctx.error("User not found", 404);
  }
  return ctx.json(user);
};

export const listFriends: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  const services = getServices(ctx);
  ctx.log("info", "listFriends", { userId: auth.userId });

  // Friends = mutual follows - get both lists and intersect
  const [followers, following] = await Promise.all([
    services.users.listFollowers(auth, {}),
    services.users.listFollowing(auth, {}),
  ]);

  const followerIds = new Set(followers.users.map((u) => u.id));
  const friends = following.users.filter((u) => followerIds.has(u.id));

  return ctx.json({ users: friends, next_offset: null });
};

export const listFollowing: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  const services = getServices(ctx);
  const params = parseInput(input, { limit: 50, offset: 0 });
  ctx.log("info", "listFollowing", { userId: auth.userId });

  const result = await services.users.listFollowing(auth, params);
  return ctx.json(result);
};

export const listFollowers: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  const services = getServices(ctx);
  const params = parseInput(input, { limit: 50, offset: 0 });
  ctx.log("info", "listFollowers", { userId: auth.userId });

  const result = await services.users.listFollowers(auth, params);
  return ctx.json(result);
};

export const listFollowRequests: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  ctx.log("info", "listFollowRequests", { userId: auth.userId });
  const services = getServices(ctx);
  const params = parseInput(input, { direction: "all" as const });
  const result = await services.users.listFollowRequests(auth, params);
  return ctx.json(result);
};

export const followUser: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  const services = getServices(ctx);
  const { id } = parseInput(input, { id: "" });
  ctx.log("info", "followUser", { userId: auth.userId, targetId: id });

  if (!id) {
    return ctx.error("Target user ID is required", 400);
  }
  await services.users.follow(auth, id);
  return ctx.json({ success: true, following: true });
};

export const unfollowUser: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  const services = getServices(ctx);
  const { id } = parseInput(input, { id: "" });
  ctx.log("info", "unfollowUser", { userId: auth.userId, targetId: id });

  if (!id) {
    return ctx.error("Target user ID is required", 400);
  }
  await services.users.unfollow(auth, id);
  return ctx.json({ success: true, following: false });
};

export const acceptFollowRequest: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  const services = getServices(ctx);
  const { id } = parseInput(input, { id: "" });
  ctx.log("info", "acceptFollowRequest", { userId: auth.userId, requesterId: id });
  if (!id) return ctx.error("Requester ID is required", 400);
  await services.users.acceptFollowRequest(auth, id);
  return ctx.json({ success: true, accepted: true });
};

export const rejectFollowRequest: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  const services = getServices(ctx);
  const { id } = parseInput(input, { id: "" });
  ctx.log("info", "rejectFollowRequest", { userId: auth.userId, requesterId: id });
  if (!id) return ctx.error("Requester ID is required", 400);
  await services.users.rejectFollowRequest(auth, id);
  return ctx.json({ success: true, rejected: true });
};

export const blockUser: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  const services = getServices(ctx);
  const { id } = parseInput(input, { id: "" });
  ctx.log("info", "blockUser", { userId: auth.userId, targetId: id });

  if (!id) {
    return ctx.error("Target user ID is required", 400);
  }
  await services.users.block(auth, id);
  return ctx.json({ success: true, blocked: true });
};

export const unblockUser: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  const services = getServices(ctx);
  const { id } = parseInput(input, { id: "" });
  ctx.log("info", "unblockUser", { userId: auth.userId, targetId: id });
  if (!id) return ctx.error("Target user ID is required", 400);
  await services.users.unblock(auth, id);
  return ctx.json({ success: true, blocked: false });
};

export const muteUser: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  const services = getServices(ctx);
  const { id } = parseInput(input, { id: "" });
  ctx.log("info", "muteUser", { userId: auth.userId, targetId: id });

  if (!id) {
    return ctx.error("Target user ID is required", 400);
  }
  await services.users.mute(auth, id);
  return ctx.json({ success: true, muted: true });
};

export const unmuteUser: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  const services = getServices(ctx);
  const { id } = parseInput(input, { id: "" });
  ctx.log("info", "unmuteUser", { userId: auth.userId, targetId: id });
  if (!id) return ctx.error("Target user ID is required", 400);
  await services.users.unmute(auth, id);
  return ctx.json({ success: true, muted: false });
};

export const listBlocks: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  const services = getServices(ctx);
  ctx.log("info", "listBlocks", { userId: auth.userId });
  const params = parseInput(input, { limit: 50, offset: 0 });
  const result = await services.users.listBlocks(auth, params);
  return ctx.json(result);
};

export const listMutes: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  const services = getServices(ctx);
  ctx.log("info", "listMutes", { userId: auth.userId });
  const params = parseInput(input, { limit: 50, offset: 0 });
  const result = await services.users.listMutes(auth, params);
  return ctx.json(result);
};

export const listNotifications: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  const services = getServices(ctx);
  ctx.log("info", "listNotifications", { userId: auth.userId });
  const params = parseInput(input, { since: undefined as string | undefined });
  const notifications = await services.users.listNotifications(auth, params);
  return ctx.json({ notifications });
};

export const markNotificationRead: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  const services = getServices(ctx);
  const { id } = parseInput(input, { id: "" });
  ctx.log("info", "markNotificationRead", { userId: auth.userId, notificationId: id });
  if (!id) return ctx.error("Notification ID is required", 400);
  const result = await services.users.markNotificationRead(auth, id);
  return ctx.json({ ...result, read: true });
};

export const listPinnedPosts: AppHandler = async (ctx, input) => {
  const auth = ctx.auth ?? { userId: null };
  const services = getServices(ctx);
  const { id } = parseInput(input, { id: "" });
  ctx.log("info", "listPinnedPosts", { userId: id });

  const posts = await services.posts.listPinnedPosts(auth as AppAuthContext, {
    user_id: id || undefined,
    limit: 20,
  });
  return ctx.json({ posts });
};

// ============================================================================
// Post Handlers
// ============================================================================

export const createPost: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  const services = getServices(ctx);
  const postInput = parseInput(input, {
    content: "",
    visibility: "public" as const,
    community_id: null,
    in_reply_to_id: null,
    media_ids: [],
    sensitive: false,
    content_warning: null,
    poll: null,
  });
  ctx.log("info", "createPost", { userId: auth.userId, hasContent: !!postInput.content });

  if (!postInput.content?.trim()) {
    return ctx.error("Content is required", 400);
  }

  const post = await services.posts.createPost(auth, postInput);
  return ctx.json(post, { status: 201 });
};

export const listPosts: AppHandler = async (ctx, input) => {
  const auth = ctx.auth ?? { userId: null };
  const services = getServices(ctx);
  const params = parseInput(input, {
    limit: 20,
    offset: 0,
    community_id: undefined,
    list_id: undefined,
  });
  ctx.log("info", "listPosts", { params });

  const result = await services.posts.listTimeline(auth as AppAuthContext, params);
  return ctx.json(result);
};

export const searchPosts: AppHandler = async (ctx, input) => {
  const auth = ctx.auth ?? { userId: null };
  const services = getServices(ctx);
  ctx.log("info", "searchPosts", { input });
  const params = parseInput(input, { query: "", limit: 20, offset: 0 });
  const result = await services.posts.searchPosts(auth as AppAuthContext, params);
  return ctx.json(result);
};

export const getPost: AppHandler = async (ctx, input) => {
  const auth = ctx.auth ?? { userId: null };
  const services = getServices(ctx);
  const { id } = parseInput(input, { id: "" });
  ctx.log("info", "getPost", { id });

  if (!id) {
    return ctx.error("Post ID is required", 400);
  }

  const post = await services.posts.getPost(auth as AppAuthContext, id);
  if (!post) {
    return ctx.error("Post not found", 404);
  }
  return ctx.json(post);
};

export const updatePost: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  const services = getServices(ctx);
  const updateInput = parseInput(input, {
    id: "",
    content: undefined,
    sensitive: undefined,
    content_warning: undefined,
    media_ids: undefined,
  });
  ctx.log("info", "updatePost", { userId: auth.userId, postId: updateInput.id });

  if (!updateInput.id) {
    return ctx.error("Post ID is required", 400);
  }

  const post = await services.posts.updatePost(auth, updateInput);
  return ctx.json(post);
};

export const deletePost: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  const services = getServices(ctx);
  const { id } = parseInput(input, { id: "" });
  ctx.log("info", "deletePost", { userId: auth.userId, postId: id });

  if (!id) {
    return ctx.error("Post ID is required", 400);
  }

  await services.posts.deletePost(auth, id);
  return ctx.json({ success: true, deleted: true });
};

export const getPostHistory: AppHandler = async (ctx, input) => {
  const auth = ctx.auth ?? { userId: null };
  const services = getServices(ctx);
  const { id } = parseInput(input, { id: "" });
  ctx.log("info", "getPostHistory", { postId: id });
  if (!id) return ctx.error("Post ID is required", 400);
  const history = await services.posts.listPostHistory(auth as AppAuthContext, id);
  return ctx.json({ history });
};

export const getPostPoll: AppHandler = async (ctx, input) => {
  const auth = ctx.auth ?? { userId: null };
  const services = getServices(ctx);
  const { id } = parseInput(input, { id: "" });
  ctx.log("info", "getPostPoll", { postId: id });
  if (!id) return ctx.error("Post ID is required", 400);
  const poll = await services.posts.getPoll(auth as AppAuthContext, id);
  return ctx.json({ poll });
};

export const voteOnPost: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  const services = getServices(ctx);
  const { id, choices } = parseInput(input, { id: "", choices: [] as number[] });
  ctx.log("info", "voteOnPost", { userId: auth.userId, postId: id });
  if (!id || !choices?.length) return ctx.error("Post ID and choices are required", 400);
  const poll = await services.posts.voteOnPoll(auth, { post_id: id, option_ids: choices.map(String) });
  return ctx.json({ poll, voted: true });
};

export const repost: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  const services = getServices(ctx);
  const { id } = parseInput(input, { id: "" });
  ctx.log("info", "repost", { userId: auth.userId, postId: id });
  if (!id) return ctx.error("Post ID is required", 400);
  const result = await services.posts.repost(auth, { post_id: id });
  return ctx.json({ ...result });
};

export const undoRepost: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  const services = getServices(ctx);
  const { id } = parseInput(input, { id: "" });
  ctx.log("info", "undoRepost", { userId: auth.userId, postId: id });
  if (!id) return ctx.error("Post ID is required", 400);
  await services.posts.undoRepost(auth, id);
  return ctx.json({ success: true, reposted: false });
};

export const listReposts: AppHandler = async (ctx, input) => {
  const auth = ctx.auth ?? { userId: null };
  const services = getServices(ctx);
  const { id } = parseInput(input, { id: "" });
  ctx.log("info", "listReposts", { postId: id });
  if (!id) return ctx.error("Post ID is required", 400);
  const result = await services.posts.listReposts(auth as AppAuthContext, { post_id: id });
  return ctx.json(result);
};

export const listPostReactions: AppHandler = async (ctx, input) => {
  const auth = ctx.auth ?? { userId: null };
  const services = getServices(ctx);
  const { id } = parseInput(input, { id: "" });
  ctx.log("info", "listPostReactions", { postId: id });
  if (!id) return ctx.error("Post ID is required", 400);
  const reactions = await services.posts.listReactions(auth as AppAuthContext, id);
  return ctx.json({ reactions });
};

export const addPostReaction: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  const services = getServices(ctx);
  const { id, emoji } = parseInput(input, { id: "", emoji: "" });
  ctx.log("info", "addPostReaction", { userId: auth.userId, postId: id, emoji });

  if (!id || !emoji) {
    return ctx.error("Post ID and emoji are required", 400);
  }

  await services.posts.reactToPost(auth, { post_id: id, emoji });
  return ctx.json({ success: true });
};

export const removePostReaction: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  const services = getServices(ctx);
  const { id, reactionId } = parseInput(input, { id: "", reactionId: "" });
  ctx.log("info", "removePostReaction", { userId: auth.userId, postId: id, reactionId });
  if (!reactionId) return ctx.error("Reaction ID is required", 400);
  await services.posts.removeReaction(auth, reactionId);
  return ctx.json({ success: true });
};

export const listComments: AppHandler = async (ctx, input) => {
  const auth = ctx.auth ?? { userId: null };
  const services = getServices(ctx);
  const { id } = parseInput(input, { id: "" });
  ctx.log("info", "listComments", { postId: id });
  if (!id) return ctx.error("Post ID is required", 400);
  const comments = await services.posts.listComments(auth as AppAuthContext, id);
  return ctx.json({ comments });
};

export const addComment: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  const services = getServices(ctx);
  const { id, content } = parseInput(input, { id: "", content: "" });
  ctx.log("info", "addComment", { userId: auth.userId, postId: id });

  if (!id || !content?.trim()) {
    return ctx.error("Post ID and content are required", 400);
  }

  // Create comment as a reply post
  const comment = await services.posts.createPost(auth, {
    content,
    in_reply_to_id: id,
  });
  return ctx.json(comment, { status: 201 });
};

export const deleteComment: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  const services = getServices(ctx);
  const { id, commentId } = parseInput(input, { id: "", commentId: "" });
  ctx.log("info", "deleteComment", { userId: auth.userId, postId: id, commentId });

  if (!commentId) {
    return ctx.error("Comment ID is required", 400);
  }

  await services.posts.deletePost(auth, commentId);
  return ctx.json({ success: true, deleted: true });
};

export const addBookmark: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  const services = getServices(ctx);
  const { id } = parseInput(input, { id: "" });
  ctx.log("info", "addBookmark", { userId: auth.userId, postId: id });
  if (!id) return ctx.error("Post ID is required", 400);
  await services.posts.addBookmark(auth, id);
  return ctx.json({ success: true, bookmarked: true });
};

export const removeBookmark: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  const services = getServices(ctx);
  const { id } = parseInput(input, { id: "" });
  ctx.log("info", "removeBookmark", { userId: auth.userId, postId: id });
  if (!id) return ctx.error("Post ID is required", 400);
  await services.posts.removeBookmark(auth, id);
  return ctx.json({ success: true, bookmarked: false });
};

export const listBookmarks: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  const services = getServices(ctx);
  ctx.log("info", "listBookmarks", { userId: auth.userId });
  const params = parseInput(input, { limit: 20, offset: 0 });
  const result = await services.posts.listBookmarks(auth, params);
  return ctx.json(result);
};

export const createCommunityPost: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  const services = getServices(ctx);
  const { id, content, ...rest } = parseInput(input, {
    id: "",
    content: "",
    visibility: "public" as const,
    media_ids: [],
    sensitive: false,
    content_warning: null,
  });
  ctx.log("info", "createCommunityPost", { userId: auth.userId, communityId: id });

  if (!id || !content?.trim()) {
    return ctx.error("Community ID and content are required", 400);
  }

  const post = await services.posts.createPost(auth, {
    content,
    community_id: id,
    ...rest,
  });
  return ctx.json(post, { status: 201 });
};

export const listCommunityPosts: AppHandler = async (ctx, input) => {
  const auth = ctx.auth ?? { userId: null };
  const services = getServices(ctx);
  const { id, limit, offset } = parseInput(input, { id: "", limit: 20, offset: 0 });
  ctx.log("info", "listCommunityPosts", { communityId: id });

  if (!id) {
    return ctx.error("Community ID is required", 400);
  }

  const result = await services.posts.listTimeline(auth as AppAuthContext, {
    community_id: id,
    limit,
    offset,
  });
  return ctx.json(result);
};

// ============================================================================
// Community Handlers
// ============================================================================

export const listCommunities: AppHandler = async (ctx, input) => {
  const auth = ctx.auth ?? { userId: null };
  const services = getServices(ctx);
  const params = parseInput(input, { limit: 20, offset: 0, query: "" });
  ctx.log("info", "listCommunities", { params });

  const result = await services.communities.listCommunities(auth as AppAuthContext, params);
  return ctx.json(result);
};

export const createCommunity: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  const services = getServices(ctx);
  const communityInput = parseInput(input, {
    name: "",
    display_name: "",
    description: "",
    icon: "",
    visibility: "public" as const,
  });
  ctx.log("info", "createCommunity", { userId: auth.userId, name: communityInput.name });

  if (!communityInput.name?.trim() || !communityInput.display_name?.trim()) {
    return ctx.error("Name and display_name are required", 400);
  }

  const community = await services.communities.createCommunity(auth, communityInput);
  return ctx.json(community, { status: 201 });
};

export const getCommunity: AppHandler = async (ctx, input) => {
  const auth = ctx.auth ?? { userId: null };
  const services = getServices(ctx);
  const { id } = parseInput(input, { id: "" });
  ctx.log("info", "getCommunity", { id });

  if (!id) {
    return ctx.error("Community ID is required", 400);
  }

  const community = await services.communities.getCommunity(auth as AppAuthContext, id);
  if (!community) {
    return ctx.error("Community not found", 404);
  }
  return ctx.json(community);
};

export const updateCommunity: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  const services = getServices(ctx);
  const updateInput = parseInput(input, {
    id: "",
    display_name: undefined,
    description: undefined,
    icon: undefined,
    visibility: undefined,
  });
  ctx.log("info", "updateCommunity", { userId: auth.userId, communityId: updateInput.id });

  if (!updateInput.id) {
    return ctx.error("Community ID is required", 400);
  }

  const community = await services.communities.updateCommunity(auth, updateInput);
  return ctx.json(community);
};

export const listChannels: AppHandler = async (ctx, input) => {
  const auth = ctx.auth ?? { userId: null };
  const services = getServices(ctx);
  const { id } = parseInput(input, { id: "" });
  ctx.log("info", "listChannels", { communityId: id });
  if (!id) return ctx.error("Community ID is required", 400);
  const channels = await services.communities.listChannels(auth as AppAuthContext, id);
  return ctx.json({ channels });
};

export const createChannel: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  const services = getServices(ctx);
  const { id, name, description } = parseInput(input, { id: "", name: "", description: "" });
  ctx.log("info", "createChannel", { userId: auth.userId, communityId: id, name });
  if (!id || !name) return ctx.error("Community ID and name are required", 400);
  const channel = await services.communities.createChannel(auth, {
    community_id: id,
    name,
    description,
  });
  return ctx.json(channel, { status: 201 });
};

export const updateChannel: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  const services = getServices(ctx);
  const { id, channelId, name, description } = parseInput(input, {
    id: "",
    channelId: "",
    name: undefined,
    description: undefined,
  });
  ctx.log("info", "updateChannel", { userId: auth.userId, communityId: id, channelId });
  if (!id || !channelId) return ctx.error("Community ID and channelId are required", 400);
  const channel = await services.communities.updateChannel(auth, {
    community_id: id,
    channel_id: channelId,
    name,
    description,
  });
  return ctx.json(channel);
};

export const deleteChannel: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  const services = getServices(ctx);
  const { id, channelId } = parseInput(input, { id: "", channelId: "" });
  ctx.log("info", "deleteChannel", { userId: auth.userId, communityId: id, channelId });
  if (!id || !channelId) return ctx.error("Community ID and channelId are required", 400);
  await services.communities.deleteChannel(auth, id, channelId);
  return ctx.json({ success: true, deleted: true });
};

export const leaveCommunity: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  const services = getServices(ctx);
  const { id } = parseInput(input, { id: "" });
  ctx.log("info", "leaveCommunity", { userId: auth.userId, communityId: id });

  if (!id) {
    return ctx.error("Community ID is required", 400);
  }

  await services.communities.leaveCommunity(auth, id);
  return ctx.json({ success: true, member: false });
};

export const sendDirectInvite: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  const services = getServices(ctx);
  const { id, userId } = parseInput(input, { id: "", userId: "" });
  ctx.log("info", "sendDirectInvite", { from: auth.userId, communityId: id, to: userId });
  if (!id || !userId) return ctx.error("Community ID and userId are required", 400);
  const invites = await services.communities.sendDirectInvite(auth, {
    community_id: id,
    user_ids: [userId],
  });
  return ctx.json({ invites });
};

export const listCommunityMembers: AppHandler = async (ctx, input) => {
  const auth = ctx.auth ?? { userId: null };
  const services = getServices(ctx);
  const { id } = parseInput(input, { id: "" });
  ctx.log("info", "listCommunityMembers", { communityId: id });
  if (!id) return ctx.error("Community ID is required", 400);
  const members = await services.communities.listMembers(auth as AppAuthContext, id);
  return ctx.json({ members });
};

export const acceptCommunityInvite: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  const services = getServices(ctx);
  const { id } = parseInput(input, { id: "" });
  ctx.log("info", "acceptCommunityInvite", { userId: auth.userId, communityId: id });

  if (!id) {
    return ctx.error("Community ID is required", 400);
  }

  await services.communities.joinCommunity(auth, id);
  return ctx.json({ success: true, member: true });
};

export const declineCommunityInvite: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  const { id } = parseInput(input, { id: "" });
  ctx.log("info", "declineCommunityInvite", { userId: auth.userId, communityId: id });
  return ctx.json({ success: true, declined: true });
};

export const getCommunityReactions: AppHandler = async (ctx, input) => {
  const auth = ctx.auth ?? { userId: null };
  const services = getServices(ctx);
  const { id } = parseInput(input, { id: "" });
  ctx.log("info", "getCommunityReactions", { communityId: id });
  if (!id) return ctx.error("Community ID is required", 400);
  const reactions = await services.communities.getReactionSummary(auth as AppAuthContext, id);
  return ctx.json({ reactions });
};

// ============================================================================
// Story Handlers
// ============================================================================

export const createStory: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  const services = getServices(ctx);
  const storyInput = parseInput(input, {
    items: [],
    community_id: null,
    audience: "all" as const,
    visible_to_friends: true,
  });
  ctx.log("info", "createStory", { userId: auth.userId, itemCount: storyInput.items?.length });

  if (!storyInput.items?.length) {
    return ctx.error("At least one item is required", 400);
  }

  const story = await services.stories.createStory(auth, storyInput);
  return ctx.json(story, { status: 201 });
};

export const listStories: AppHandler = async (ctx, input) => {
  const auth = ctx.auth ?? { userId: null };
  const services = getServices(ctx);
  const params = parseInput(input, { limit: 20, offset: 0, community_id: undefined });
  ctx.log("info", "listStories", { params });

  const result = await services.stories.listStories(auth as AppAuthContext, params);
  return ctx.json(result);
};

export const getStory: AppHandler = async (ctx, input) => {
  const auth = ctx.auth ?? { userId: null };
  const services = getServices(ctx);
  const { id } = parseInput(input, { id: "" });
  ctx.log("info", "getStory", { id });

  if (!id) {
    return ctx.error("Story ID is required", 400);
  }

  const story = await services.stories.getStory(auth as AppAuthContext, id);
  if (!story) {
    return ctx.error("Story not found", 404);
  }
  return ctx.json(story);
};

export const updateStory: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  const services = getServices(ctx);
  const { id } = parseInput(input, { id: "" });
  ctx.log("info", "updateStory", { userId: auth.userId, storyId: id });
  if (!id) return ctx.error("Story ID is required", 400);
  const story = await services.stories.updateStory(auth, parseInput(input, { id, items: undefined, audience: undefined, visible_to_friends: undefined }));
  return ctx.json(story);
};

export const deleteStory: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  const services = getServices(ctx);
  const { id } = parseInput(input, { id: "" });
  ctx.log("info", "deleteStory", { userId: auth.userId, storyId: id });

  if (!id) {
    return ctx.error("Story ID is required", 400);
  }

  await services.stories.deleteStory(auth, id);
  return ctx.json({ success: true, deleted: true });
};

export const createCommunityStory: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  const services = getServices(ctx);
  const { id, items, audience, visible_to_friends } = parseInput(input, {
    id: "",
    items: [],
    audience: "community" as const,
    visible_to_friends: false,
  });
  ctx.log("info", "createCommunityStory", { userId: auth.userId, communityId: id });

  if (!id || !items?.length) {
    return ctx.error("Community ID and items are required", 400);
  }

  const story = await services.stories.createStory(auth, {
    items,
    community_id: id,
    audience,
    visible_to_friends,
  });
  return ctx.json(story, { status: 201 });
};

export const listCommunityStories: AppHandler = async (ctx, input) => {
  const auth = ctx.auth ?? { userId: null };
  const services = getServices(ctx);
  const { id, limit, offset } = parseInput(input, { id: "", limit: 20, offset: 0 });
  ctx.log("info", "listCommunityStories", { communityId: id });

  if (!id) {
    return ctx.error("Community ID is required", 400);
  }

  const result = await services.stories.listStories(auth as AppAuthContext, {
    community_id: id,
    limit,
    offset,
  });
  return ctx.json(result);
};

// ============================================================================
// DM/Chat Handlers
// ============================================================================

export const listDmThreads: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  const services = getServices(ctx);
  const params = parseInput(input, { limit: 20, offset: 0 });
  ctx.log("info", "listDmThreads", { userId: auth.userId });

  const result = await services.dm.listThreads(auth, params);
  return ctx.json(result);
};

export const getDmThreadMessages: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  const services = getServices(ctx);
  const { threadId, limit, offset } = parseInput(input, { threadId: "", limit: 50, offset: 0 });
  ctx.log("info", "getDmThreadMessages", { userId: auth.userId, threadId });

  if (!threadId) {
    return ctx.error("Thread ID is required", 400);
  }

  const result = await services.dm.listMessages(auth, { thread_id: threadId, limit, offset });
  return ctx.json(result);
};

export const getOrCreateDmThread: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  const services = getServices(ctx);
  const { handle } = parseInput(input, { handle: "" });
  ctx.log("info", "getOrCreateDmThread", { userId: auth.userId, handle });

  if (!handle) {
    return ctx.error("Handle is required", 400);
  }

  const result = await services.dm.openThread(auth, { participants: [handle] });
  return ctx.json(result);
};

export const sendDm: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  const services = getServices(ctx);
  const { thread_id, participants, content, media_ids } = parseInput(input, {
    thread_id: undefined as string | undefined,
    participants: undefined as string[] | undefined,
    content: "",
    media_ids: [] as string[],
  });
  ctx.log("info", "sendDm", { userId: auth.userId, threadId: thread_id });

  if (!content?.trim()) {
    return ctx.error("Content is required", 400);
  }
  if (!thread_id && (!participants || participants.length === 0)) {
    return ctx.error("Either thread_id or participants is required", 400);
  }

  const message = await services.dm.sendMessage(auth, {
    thread_id,
    participants,
    content,
    media_ids,
  });
  return ctx.json(message, { status: 201 });
};

export const listChannelMessages: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  const services = getServices(ctx);
  const { id, channelId, limit, offset } = parseInput(input, {
    id: "",
    channelId: "",
    limit: 50,
    offset: 0,
  });
  ctx.log("info", "listChannelMessages", { communityId: id, channelId });
  if (!id || !channelId) return ctx.error("Community ID and channelId are required", 400);
  const messages = await services.communities.listChannelMessages(auth, {
    community_id: id,
    channel_id: channelId,
    limit,
    offset,
  });
  return ctx.json({ messages });
};

export const sendChannelMessage: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  const services = getServices(ctx);
  const { id, channelId, content, media_ids } = parseInput(input, {
    id: "",
    channelId: "",
    content: "",
    media_ids: [],
  });
  ctx.log("info", "sendChannelMessage", { userId: auth.userId, communityId: id, channelId });
  if (!id || !channelId || !content?.trim()) {
    return ctx.error("Community ID, channelId, and content are required", 400);
  }
  const result = await services.communities.sendChannelMessage(auth, {
    community_id: id,
    channel_id: channelId,
    content,
    media_ids,
    recipients: [],
  });
  return ctx.json({ success: true, activity: result.activity }, { status: 201 });
};

// ============================================================================
// Media/Storage Handlers
// ============================================================================

export const uploadMedia: AppHandler = async (ctx, input) => {
  ctx.log("info", "uploadMedia handler invoked");
  return ctx.redirect("/media/upload", 307);
};

export const listStorageObjects: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  const services = getServices(ctx);
  const params = parseInput(input, { limit: 50, offset: 0 });
  ctx.log("info", "listStorageObjects", { userId: auth.userId });
  const media = services.media
    ? await services.media.listStorage(auth, params)
    : { files: [], next_offset: null };
  return ctx.json(media);
};

export const uploadStorageObject: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  ctx.log("info", "uploadStorageObject", { userId: auth.userId });
  return ctx.redirect("/storage/upload", 307);
};

export const deleteStorageObject: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  const services = getServices(ctx);
  const { key } = parseInput(input, { key: "" });
  ctx.log("info", "deleteStorageObject", { userId: auth.userId, key });
  if (!key) return ctx.error("key is required", 400);
  if (!services.media) return ctx.error("Media service not configured", 500);
  const result = await services.media.deleteStorageObject(auth, key);
  return ctx.json(result);
};

// ============================================================================
// Realtime Handler
// ============================================================================

export const streamRealtime: AppHandler = async (ctx, input) => {
  ctx.log("info", "streamRealtime handler invoked");
  return ctx.redirect("/realtime/stream", 307);
};

// ============================================================================
// ActivityPub Mapping Handlers (for UI rendering)
// ============================================================================

export const mapActivityNote: AppHandler = async (ctx, input) => {
  ctx.log("info", "mapActivityNote", { input: !!input });
  // Map ActivityPub Note to view model
  const activity = input as Record<string, unknown> | null;
  if (!activity) {
    return ctx.error("Activity object is required", 400);
  }
  // Basic mapping - full implementation would transform AP object to Post
  return ctx.json({
    type: "post",
    id: activity.id,
    content: activity.content,
    author: activity.attributedTo,
    created_at: activity.published,
  });
};

export const mapActivityQuestion: AppHandler = async (ctx, input) => {
  ctx.log("info", "mapActivityQuestion", { input: !!input });
  // Map ActivityPub Question to poll view
  const activity = input as Record<string, unknown> | null;
  if (!activity) {
    return ctx.error("Activity object is required", 400);
  }
  return ctx.json({
    type: "poll",
    id: activity.id,
    question: activity.content,
    options: activity.oneOf || activity.anyOf || [],
    closed: activity.closed,
  });
};

export const mapActivityAnnounce: AppHandler = async (ctx, input) => {
  ctx.log("info", "mapActivityAnnounce", { input: !!input });
  // Map ActivityPub Announce to repost
  const activity = input as Record<string, unknown> | null;
  if (!activity) {
    return ctx.error("Activity object is required", 400);
  }
  return ctx.json({
    type: "repost",
    id: activity.id,
    original_id: activity.object,
    reposted_by: activity.actor,
    created_at: activity.published,
  });
};

// ============================================================================
// Handler Registry Export
// ============================================================================

const handlers: Record<string, AppHandler> = {
  // Auth
  authLogin,
  issueSessionToken,
  logout,
  ownerActors,

  // Users
  getCurrentUser,
  updateProfile,
  searchUsers,
  getUser,
  listFriends,
  listFollowing,
  listFollowers,
  listFollowRequests,
  followUser,
  unfollowUser,
  acceptFollowRequest,
  rejectFollowRequest,
  blockUser,
  unblockUser,
  muteUser,
  unmuteUser,
  listBlocks,
  listMutes,
  listNotifications,
  markNotificationRead,
  listPinnedPosts,

  // Posts
  createPost,
  listPosts,
  searchPosts,
  getPost,
  updatePost,
  deletePost,
  getPostHistory,
  getPostPoll,
  voteOnPost,
  repost,
  undoRepost,
  listReposts,
  listPostReactions,
  addPostReaction,
  removePostReaction,
  listComments,
  addComment,
  deleteComment,
  addBookmark,
  removeBookmark,
  listBookmarks,
  createCommunityPost,
  listCommunityPosts,

  // Communities
  listCommunities,
  createCommunity,
  getCommunity,
  updateCommunity,
  listChannels,
  createChannel,
  updateChannel,
  deleteChannel,
  leaveCommunity,
  sendDirectInvite,
  listCommunityMembers,
  acceptCommunityInvite,
  declineCommunityInvite,
  getCommunityReactions,

  // Stories
  createStory,
  listStories,
  getStory,
  updateStory,
  deleteStory,
  createCommunityStory,
  listCommunityStories,

  // DM/Chat
  listDmThreads,
  getDmThreadMessages,
  getOrCreateDmThread,
  sendDm,
  listChannelMessages,
  sendChannelMessage,

  // Media/Storage
  uploadMedia,
  listStorageObjects,
  uploadStorageObject,
  deleteStorageObject,

  // Realtime
  streamRealtime,

  // ActivityPub mapping
  mapActivityNote,
  mapActivityQuestion,
  mapActivityAnnounce,
};

export { handlers };
export default handlers;
