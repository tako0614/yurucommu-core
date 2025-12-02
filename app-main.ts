import type { AppHandler } from "@takos/platform/app";

type HandlerBinding = {
  name: string;
  route: string;
  summary?: string;
};

function createPlaceholderHandler(binding: HandlerBinding): AppHandler {
  return (ctx) => {
    ctx.log("info", "app-main placeholder invoked", {
      handler: binding.name,
      route: binding.route,
      summary: binding.summary,
    });
    const message =
      `${binding.route} is mapped to "${binding.name}" but is not wired to core services yet.`;
    return ctx.error(message, 501);
  };
}

const bindings: HandlerBinding[] = [
  { name: "ownerActors", route: "POST /auth/owner/actors", summary: "Owner actor create/switch" },
  { name: "authLogin", route: "POST /auth/login", summary: "Owner login" },
  { name: "issueSessionToken", route: "POST /auth/session/token", summary: "Issue session token" },
  { name: "logout", route: "POST /auth/logout", summary: "Logout current session" },

  { name: "getCurrentUser", route: "GET /me", summary: "Current user profile" },
  { name: "updateProfile", route: "PATCH /me", summary: "Update profile" },
  { name: "searchUsers", route: "GET /users", summary: "Search users" },
  { name: "getUser", route: "GET /users/:id", summary: "Get user by id" },
  { name: "listFriends", route: "GET /me/friends", summary: "List mutual follows" },
  { name: "listFollowing", route: "GET /me/following", summary: "List following" },
  { name: "listFollowers", route: "GET /me/followers", summary: "List followers" },
  { name: "listFollowRequests", route: "GET /me/follow-requests", summary: "List follow requests" },
  { name: "followUser", route: "POST /users/:id/follow", summary: "Follow user" },
  { name: "unfollowUser", route: "DELETE /users/:id/follow", summary: "Unfollow user" },
  { name: "acceptFollowRequest", route: "POST /users/:id/follow/accept", summary: "Accept follow" },
  { name: "rejectFollowRequest", route: "POST /users/:id/follow/reject", summary: "Reject follow" },
  { name: "blockUser", route: "POST /users/:id/block", summary: "Block user" },
  { name: "unblockUser", route: "DELETE /users/:id/block", summary: "Unblock user" },
  { name: "muteUser", route: "POST /users/:id/mute", summary: "Mute user" },
  { name: "unmuteUser", route: "DELETE /users/:id/mute", summary: "Unmute user" },
  { name: "listBlocks", route: "GET /me/blocks", summary: "List blocks" },
  { name: "listMutes", route: "GET /me/mutes", summary: "List mutes" },
  { name: "listNotifications", route: "GET /notifications", summary: "List notifications" },
  { name: "markNotificationRead", route: "POST /notifications/:id/read", summary: "Mark notification read" },
  { name: "listPinnedPosts", route: "GET /users/:id/pinned", summary: "Pinned posts" },

  { name: "createPost", route: "POST /posts", summary: "Create post" },
  { name: "listPosts", route: "GET /posts", summary: "List posts" },
  { name: "searchPosts", route: "GET /posts/search", summary: "Search posts" },
  { name: "getPost", route: "GET /posts/:id", summary: "Get post" },
  { name: "updatePost", route: "PATCH /posts/:id", summary: "Update post" },
  { name: "deletePost", route: "DELETE /posts/:id", summary: "Delete post" },
  { name: "getPostHistory", route: "GET /posts/:id/history", summary: "Post history" },
  { name: "getPostPoll", route: "GET /posts/:id/poll", summary: "Post poll" },
  { name: "voteOnPost", route: "POST /posts/:id/vote", summary: "Vote on poll" },
  { name: "repost", route: "POST /posts/:id/reposts", summary: "Repost/boost" },
  { name: "undoRepost", route: "DELETE /posts/:id/reposts", summary: "Undo repost" },
  { name: "listReposts", route: "GET /posts/:id/reposts", summary: "List reposts" },
  { name: "listPostReactions", route: "GET /posts/:id/reactions", summary: "List reactions" },
  { name: "addPostReaction", route: "POST /posts/:id/reactions", summary: "Add reaction" },
  { name: "removePostReaction", route: "DELETE /posts/:id/reactions/:reactionId", summary: "Remove reaction" },
  { name: "listComments", route: "GET /posts/:id/comments", summary: "List comments" },
  { name: "addComment", route: "POST /posts/:id/comments", summary: "Add comment" },
  { name: "deleteComment", route: "DELETE /posts/:id/comments/:commentId", summary: "Delete comment" },
  { name: "addBookmark", route: "POST /posts/:id/bookmark", summary: "Bookmark post" },
  { name: "removeBookmark", route: "DELETE /posts/:id/bookmark", summary: "Remove bookmark" },
  { name: "listBookmarks", route: "GET /me/bookmarks", summary: "List bookmarks" },
  { name: "createCommunityPost", route: "POST /communities/:id/posts", summary: "Create community post" },
  { name: "listCommunityPosts", route: "GET /communities/:id/posts", summary: "List community posts" },

  { name: "listCommunities", route: "GET /communities", summary: "List communities" },
  { name: "createCommunity", route: "POST /communities", summary: "Create community" },
  { name: "getCommunity", route: "GET /communities/:id", summary: "Get community" },
  { name: "updateCommunity", route: "PATCH /communities/:id", summary: "Update community" },
  { name: "listChannels", route: "GET /communities/:id/channels", summary: "List channels" },
  { name: "createChannel", route: "POST /communities/:id/channels", summary: "Create channel" },
  { name: "updateChannel", route: "PATCH /communities/:id/channels/:channelId", summary: "Update channel" },
  { name: "deleteChannel", route: "DELETE /communities/:id/channels/:channelId", summary: "Delete channel" },
  { name: "leaveCommunity", route: "POST /communities/:id/leave", summary: "Leave community" },
  { name: "sendDirectInvite", route: "POST /communities/:id/direct-invites", summary: "Direct invite" },
  { name: "listCommunityMembers", route: "GET /communities/:id/members", summary: "List community members" },
  { name: "acceptCommunityInvite", route: "POST /communities/:id/invitations/accept", summary: "Accept invite" },
  { name: "declineCommunityInvite", route: "POST /communities/:id/invitations/decline", summary: "Decline invite" },
  { name: "getCommunityReactions", route: "GET /communities/:id/reactions-summary", summary: "Community reactions" },

  { name: "createStory", route: "POST /stories", summary: "Create story" },
  { name: "listStories", route: "GET /stories", summary: "List stories" },
  { name: "getStory", route: "GET /stories/:id", summary: "Get story" },
  { name: "updateStory", route: "PATCH /stories/:id", summary: "Update story" },
  { name: "deleteStory", route: "DELETE /stories/:id", summary: "Delete story" },
  { name: "createCommunityStory", route: "POST /communities/:id/stories", summary: "Create community story" },
  { name: "listCommunityStories", route: "GET /communities/:id/stories", summary: "List community stories" },

  { name: "listDmThreads", route: "GET /dm/threads", summary: "List DM threads" },
  { name: "getDmThreadMessages", route: "GET /dm/threads/:threadId/messages", summary: "Get DM thread messages" },
  { name: "getOrCreateDmThread", route: "GET /dm/with/:handle", summary: "Get or create DM thread" },
  { name: "sendDm", route: "POST /dm/send", summary: "Send DM" },
  { name: "listChannelMessages", route: "GET /communities/:id/channels/:channelId/messages", summary: "List channel messages" },
  { name: "sendChannelMessage", route: "POST /communities/:id/channels/:channelId/messages", summary: "Send channel message" },

  { name: "uploadMedia", route: "POST /media/upload", summary: "Upload media" },
  { name: "listStorageObjects", route: "GET /storage", summary: "List storage objects" },
  { name: "uploadStorageObject", route: "POST /storage/upload", summary: "Upload storage object" },
  { name: "deleteStorageObject", route: "DELETE /storage", summary: "Delete storage object" },

  { name: "streamRealtime", route: "GET /realtime/stream", summary: "Realtime SSE stream" },

  { name: "mapActivityNote", route: "ActivityPub Note|Article", summary: "Map AP Note to view model" },
  { name: "mapActivityQuestion", route: "ActivityPub Question", summary: "Map AP Question to poll view" },
  { name: "mapActivityAnnounce", route: "ActivityPub Announce", summary: "Map AP Announce to repost" }
];

const handlers = bindings.reduce<Record<string, AppHandler>>((acc, binding) => {
  acc[binding.name] = createPlaceholderHandler(binding);
  return acc;
}, {});

export { handlers };
export default handlers;
