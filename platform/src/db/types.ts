/// <reference types="@cloudflare/workers-types" />

/**
 * Database API interface with multi-instance support
 * This interface defines all database operations for the Takos platform.
 * Implementations should provide these methods using a specific database binding.
 */

// Type definitions for database operations
export type FriendStatus = "pending" | "accepted" | "rejected";

export type NullableDate = string | Date | null | undefined;

export interface UserInput {
  id?: string;
  handle?: string | null;
  display_name: string;
  avatar_url?: string;
  created_at?: string | Date;
  is_private?: number | boolean;
  profile_completed_at?: string | Date | null;
}

export interface UserUpdateFields {
  display_name?: string;
  avatar_url?: string;
  is_private?: number | boolean;
  profile_completed_at?: string | Date | null;
}

export interface UserAccountInput {
  id: string;
  user_id: string;
  provider: string;
  provider_account_id: string;
  created_at?: string | Date;
  updated_at?: string | Date;
}

export interface SessionInput {
  id: string;
  user_id: string;
  created_at?: string | Date;
  last_seen?: string | Date;
  expires_at?: string | Date | null;
}

export interface SessionUpdateData {
  last_seen?: string | Date;
  expires_at?: string | Date | null;
}

export interface NotificationInput {
  id: string;
  user_id: string;
  type: string;
  actor_id: string;
  ref_type: string;
  ref_id: string;
  message?: string;
  created_at?: string | Date;
  read?: boolean | number;
}

export interface CommunityInput {
  id: string;
  name: string;
  icon_url?: string;
  visibility?: string;
  created_by: string;
  created_at: string | Date;
}

export interface MembershipInput {
  role?: string;
  nickname?: string;
  joined_at?: string | Date;
  status?: string;
}

export interface ChannelInput {
  id: string;
  name: string;
  created_at?: string | Date;
}

export interface ListInput {
  id: string;
  owner_id: string;
  name: string;
  description?: string;
  is_public?: number | boolean;
  created_at?: string | Date;
  updated_at?: string | Date;
}

export interface ListMemberInput {
  list_id: string;
  user_id: string;
  added_at?: string | Date;
}

export interface InviteInput {
  code: string;
  community_id: string;
  expires_at?: NullableDate;
  created_by: string;
  max_uses?: number;
  uses?: number;
  active?: boolean | number;
}

export interface MemberInviteInput {
  id: string;
  community_id: string;
  invited_user_id: string;
  invited_by: string;
  status?: string;
  created_at?: string | Date;
}

export interface PostInput {
  id: string;
  community_id: string | null;
  author_id: string;
  type: string;
  text?: string;
  content_warning?: string | null;
  sensitive?: boolean;
  media?: MediaInput[];
  media_urls?: string[];
  created_at: string | Date;
  pinned?: boolean | number;
  broadcast_all?: boolean;
  visible_to_friends?: boolean;
  edit_count?: number;
  attributed_community_id?: string | null;
  ap_object_id?: string | null;
  ap_activity_id?: string | null;
}

export interface ReactionInput {
  id: string;
  post_id: string;
  user_id: string;
  emoji: string;
  created_at: string | Date;
  ap_activity_id?: string | null;
}

export interface BookmarkInput {
  id: string;
  user_id: string;
  post_id: string;
  created_at?: string | Date;
}

export interface CommentInput {
  id: string;
  post_id: string;
  author_id: string;
  text: string;
  created_at: string | Date;
  ap_object_id?: string | null;
  ap_activity_id?: string | null;
}

export interface MediaInput {
  url: string;
  description?: string | null;
  content_type?: string | null;
}

export interface MediaRecordInput extends MediaInput {
  key: string;
  user_id: string;
  created_at?: string | Date;
  updated_at?: string | Date;
}

export interface PostEditHistoryInput {
  id: string;
  post_id: string;
  editor_id: string;
  previous_text: string;
  previous_media_json: string;
  diff_json: string;
  created_at?: string | Date;
}

export interface PollOptionInput {
  id: string;
  poll_id: string;
  text: string;
  order_index?: number;
}

export interface PollInput {
  id: string;
  post_id: string;
  question: string;
  allows_multiple?: boolean | number;
  anonymous?: boolean | number;
  expires_at?: string | Date | null;
  options: PollOptionInput[];
}

export interface StoryInput {
  id: string;
  community_id: string | null;
  author_id: string;
  created_at: string | Date;
  expires_at: string | Date;
  items: any[];
  broadcast_all?: boolean;
  visible_to_friends?: boolean;
  attributed_community_id?: string | null;
}

export interface PushDeviceInput {
  user_id: string;
  token: string;
  platform: string;
  device_name?: string | null;
  locale?: string | null;
}

// Host user management (instance-independent)
// ActivityPub types
export interface ApFollowerInput {
  id?: string;
  local_user_id: string;
  remote_actor_id: string;
  activity_id: string;
  status: string;
  created_at?: string | Date;
  accepted_at?: string | Date | null;
}

export interface ApInboxActivityInput {
  id?: string;
  local_user_id: string;
  remote_actor_id: string;
  activity_id: string;
  activity_type: string;
  activity_json: string;
  status?: string;
  created_at?: string | Date;
}

export interface ApOutboxActivityInput {
  id?: string;
  local_user_id: string;
  activity_id: string;
  activity_type: string;
  activity_json: string;
  object_id?: string | null;
  object_type?: string | null;
  created_at?: string | Date;
}

export interface ApDeliveryQueueInput {
  id?: string;
  activity_id: string;
  target_inbox_url: string;
  status?: string;
  retry_count?: number;
  last_error?: string | null;
  last_attempt_at?: string | Date | null;
  delivered_at?: string | Date | null;
  created_at?: string | Date;
}

export interface ApReactionInput {
  id?: string;
  post_id: string;
  user_id: string;
  emoji: string;
  created_at?: string | Date;
  ap_activity_id?: string | null;
}

export interface ApAnnounceInput {
  id?: string;
  activity_id: string;
  actor_id: string;
  object_id: string;
  local_post_id: string;
  created_at?: string | Date;
}

export interface ApRemotePostInput {
  id?: string;
  community_id?: string | null;
  attributed_community_id?: string | null;
  author_id: string;
  text: string;
  content_warning?: string | null;
  sensitive?: boolean;
  created_at?: string | Date;
  type?: string;
  media_urls?: Array<string | MediaInput>;
  ap_object_id?: string | null;
  ap_attributed_to?: string | null;
  in_reply_to?: string | null;
  ap_activity_id?: string | null;
}

export interface ApRemoteCommentInput {
  id?: string;
  post_id: string;
  author_id: string;
  text: string;
  created_at?: string | Date;
  ap_object_id?: string | null;
  ap_activity_id?: string | null;
}

export interface ClaimedDeliveryBatch {
  ids: string[];
  deliveries: Array<{
    id: string;
    activity_id: string;
    target_inbox_url: string;
    retry_count: number;
    activity_json: string;
    local_user_id: string;
  }>;
}

export interface ClaimedInboxBatch {
  activities: Array<{
    id: string;
    activity_json: string;
    local_user_id: string;
  }>;
}

/**
 * Complete Database API interface with instance support
 */
export interface DatabaseAPI {
  // Users
  getUser(id: string): Promise<any>;
  getUserByHandle(handle: string): Promise<any>;
  searchUsersByName(query: string, limit?: number): Promise<any[]>;
  createUser(user: UserInput): Promise<any>;
  updateUser(id: string, fields: UserUpdateFields): Promise<any>;
  renameUserId(oldId: string, newId: string): Promise<any>;

  // User Accounts
  getAccountByProvider(provider: string, providerAccountId: string): Promise<any>;
  createUserAccount(account: UserAccountInput): Promise<any>;
  updateAccountUser(provider: string, providerAccountId: string, user_id: string): Promise<any>;
  updateUserAccountPassword(accountId: string, newPasswordHash: string): Promise<any>;
  listAccountsByUser(user_id: string): Promise<any[]>;

  // JWT
  getUserJwtSecret(userId: string): Promise<string | null>;
  setUserJwtSecret(userId: string, secret: string): Promise<void>;

  // Friends (mutual follows via ActivityPub)
  // Compatibility helpers for old code
  areFriends(userId1: string, userId2: string): Promise<boolean>;
  listFriends(userId: string): Promise<any[]>;

  // Blocks & Mutes
  blockUser(blocker_id: string, blocked_id: string): Promise<void>;
  unblockUser(blocker_id: string, blocked_id: string): Promise<void>;
  listBlockedUsers(blocker_id: string): Promise<any[]>;
  listUsersBlocking(user_id: string): Promise<string[]>;
  isBlocked(blocker_id: string, target_id: string): Promise<boolean>;
  muteUser(muter_id: string, muted_id: string): Promise<void>;
  unmuteUser(muter_id: string, muted_id: string): Promise<void>;
  listMutedUsers(muter_id: string): Promise<any[]>;
  isMuted(muter_id: string, target_id: string): Promise<boolean>;

  // Notifications
  addNotification(notification: NotificationInput): Promise<any>;
  listNotifications(user_id: string): Promise<any[]>;
  listNotificationsSince?(user_id: string, since: Date | string): Promise<any[]>;
  markNotificationRead(id: string): Promise<void>;
  countUnreadNotifications(user_id: string): Promise<number>;

  // Communities & Memberships
  createCommunity(community: CommunityInput): Promise<any>;
  getCommunity(id: string): Promise<any>;
  updateCommunity(id: string, fields: Record<string, any>): Promise<any>;
  searchCommunities?(query: string, userId?: string): Promise<any[]>;
  setMembership(community_id: string, user_id: string, membership: MembershipInput): Promise<void>;
  removeMembership?(community_id: string, user_id: string): Promise<void>;
  hasMembership(community_id: string, user_id: string): Promise<boolean>;
  listMembershipsByCommunity(community_id: string): Promise<any[]>;
  listUserCommunities(user_id: string): Promise<any[]>;
  listCommunityMembersWithUsers(community_id: string): Promise<any[]>;

  // Channels
  listChannelsByCommunity(community_id: string): Promise<any[]>;
  createChannel(community_id: string, channel: ChannelInput): Promise<any>;
  getChannel(community_id: string, id: string): Promise<any>;
  getChannelByName?(community_id: string, name: string): Promise<any>;
  updateChannel?(community_id: string, id: string, fields: { name?: string }): Promise<any>;
  deleteChannel(community_id: string, id: string): Promise<void>;

  // Lists
  createList(list: ListInput): Promise<any>;
  updateList(id: string, fields: Partial<ListInput>): Promise<any>;
  getList(id: string): Promise<any>;
  deleteList?(id: string): Promise<void>;
  listListsByOwner(owner_id: string): Promise<any[]>;
  addListMember(member: ListMemberInput): Promise<any>;
  removeListMember(list_id: string, user_id: string): Promise<void>;
  listMembersByList(list_id: string): Promise<any[]>;

  // Invites
  createInvite(invite: InviteInput): Promise<any>;
  listInvites(community_id: string): Promise<any[]>;
  getInvite(code: string): Promise<any>;
  updateInvite(code: string, fields: Record<string, any>): Promise<any>;
  disableInvite(code: string): Promise<any>;
  resetInvites(community_id: string): Promise<void>;

  // Member Invites
  createMemberInvite(invite: MemberInviteInput): Promise<any>;
  listMemberInvitesByCommunity(community_id: string): Promise<any[]>;
  listMemberInvitesForUser(user_id: string): Promise<any[]>;
  getMemberInvite(id: string): Promise<any>;
  setMemberInviteStatus(id: string, status: string): Promise<any>;

  // Posts
  createPost(post: PostInput): Promise<any>;
  getPost(id: string): Promise<any>;
  listPostsByCommunity(community_id: string): Promise<any[]>;
  listPinnedPostsByUser?(user_id: string, limit?: number): Promise<any[]>;
  countPinnedPostsByUser?(user_id: string): Promise<number>;
  listGlobalPostsForUser(user_id: string): Promise<any[]>;
  searchPublicPosts(query: string, limit?: number, offset?: number): Promise<any[]>;
  listPostsByHashtag(tag: string): Promise<any[]>;
  listTrendingHashtags(since: Date, limit?: number): Promise<Array<{ tag: string; uses: number }>>;
  listHashtagsForPost(post_id: string): Promise<string[]>;
  setPostHashtags(post_id: string, tags: string[]): Promise<void>;
  setPostMentions(post_id: string, userIds: string[]): Promise<void>;
  listMentionedUsers(post_id: string): Promise<string[]>;
  updatePost(id: string, fields: Record<string, any>): Promise<any>;
  createPostEditHistory?(history: PostEditHistoryInput): Promise<any>;
  listPostEditHistory?(post_id: string, limit?: number, offset?: number): Promise<any[]>;
  deletePost?(id: string): Promise<void>;

  // Polls
  createPoll?(poll: PollInput): Promise<any>;
  getPollByPost?(post_id: string): Promise<any | null>;
  listPollsByPostIds?(post_ids: string[]): Promise<any[]>;
  listPollVotes?(poll_id: string): Promise<any[]>;
  listPollVotesByUser?(poll_id: string, user_id: string): Promise<any[]>;
  createPollVotes?(poll_id: string, option_ids: string[], user_id: string): Promise<void>;

  // Reactions
  addReaction(reaction: ReactionInput): Promise<any>;
  listReactionsByPost(post_id: string): Promise<any[]>;
  listReactionsByUser?(user_id: string): Promise<any[]>;
  getReaction(id: string): Promise<any>;
  deleteReaction(id: string): Promise<void>;

  // Reposts
  addRepost(input: { id: string; post_id: string; user_id: string; comment?: string; created_at?: string | Date; ap_activity_id?: string | null }): Promise<any>;
  deleteRepost(post_id: string, user_id: string): Promise<void>;
  listRepostsByPost(post_id: string, limit?: number, offset?: number): Promise<any[]>;
  countRepostsByPost(post_id: string): Promise<number>;
  findRepost(post_id: string, user_id: string): Promise<any | null>;

  // Comments
  addComment(comment: CommentInput): Promise<any>;
  listCommentsByPost(post_id: string): Promise<any[]>;
  getComment(id: string): Promise<any>;
  deleteComment(id: string): Promise<void>;

  // Media
  upsertMedia?(media: MediaRecordInput): Promise<any>;
  getMedia?(key: string): Promise<any>;
  listMediaByUser?(user_id: string): Promise<any[]>;
  deleteMedia?(key: string): Promise<void>;

  // Bookmarks
  addBookmark(input: BookmarkInput): Promise<any>;
  deleteBookmark(post_id: string, user_id: string): Promise<void>;
  listBookmarksByUser(user_id: string, limit?: number, offset?: number): Promise<any[]>;
  getBookmarkedPostIds(user_id: string, postIds: string[]): Promise<Set<string>>;
  isPostBookmarked(post_id: string, user_id: string): Promise<boolean>;

  // Stories
  createStory(story: StoryInput): Promise<any>;
  getStory(id: string): Promise<any>;
  listStoriesByCommunity(community_id: string): Promise<any[]>;
  listGlobalStoriesForUser(user_id: string): Promise<any[]>;
  updateStory(id: string, fields: Record<string, any>): Promise<any>;
  deleteStory(id: string): Promise<void>;

  // Push Devices
  registerPushDevice(device: PushDeviceInput): Promise<any>;
  listPushDevicesByUser(user_id: string): Promise<any[]>;
  removePushDevice(token: string): Promise<void>;

  // Chat - DM
  upsertDmThread(participantsHash: string, participantsJson: string): Promise<any>;
  createDmMessage(threadId: string, authorId: string, contentHtml: string, rawActivity: any): Promise<any>;
  listDmMessages(threadId: string, limit?: number): Promise<any[]>;

  // Chat - Channel
  createChannelMessageRecord(communityId: string, channelId: string, authorId: string, contentHtml: string, rawActivity: any): Promise<any>;
  listChannelMessages(communityId: string, channelId: string, limit?: number): Promise<any[]>;

  // Sessions
  createSession(session: SessionInput): Promise<any>;
  getSession(id: string): Promise<any>;
  updateSession(id: string, data: SessionUpdateData): Promise<any>;
  deleteSession(id: string): Promise<void>;

  // ActivityPub - Followers
  upsertApFollower(input: ApFollowerInput): Promise<any>;
  deleteApFollowers(local_user_id: string, remote_actor_id: string): Promise<void>;
  findApFollower(local_user_id: string, remote_actor_id: string): Promise<any | null>;
  countApFollowers(local_user_id: string, status?: string): Promise<number>;
  listApFollowers(
    local_user_id: string,
    status?: string | null,
    limit?: number,
    offset?: number,
  ): Promise<Array<{ remote_actor_id: string; status?: string | null; created_at?: Date | string; accepted_at?: Date | string | null }>>;

  // ActivityPub - Follows
  deleteApFollows(local_user_id: string, remote_actor_id: string): Promise<void>;
  updateApFollowsStatus(local_user_id: string, remote_actor_id: string, status: string, accepted_at?: Date): Promise<void>;
  countApFollows(local_user_id: string, status?: string): Promise<number>;
  listApFollows(
    local_user_id: string,
    status?: string | null,
    limit?: number,
    offset?: number,
  ): Promise<Array<{ remote_actor_id: string; status?: string | null; created_at?: Date | string; accepted_at?: Date | string | null }>>;

  // ActivityPub - Inbox Activities
  createApInboxActivity(input: ApInboxActivityInput): Promise<any>;
  updateApInboxActivityStatus(id: string, status: string, error_message?: string, processed_at?: Date): Promise<void>;
  claimPendingInboxActivities(batchSize: number): Promise<ClaimedInboxBatch>;

  // ActivityPub - Outbox Activities
  upsertApOutboxActivity(input: ApOutboxActivityInput): Promise<any>;

  // ActivityPub - Delivery Queue
  createApDeliveryQueueItem(input: ApDeliveryQueueInput): Promise<any>;
  updateApDeliveryQueueStatus(id: string, status: string, fields?: Partial<ApDeliveryQueueInput>): Promise<void>;
  claimPendingDeliveries(batchSize: number): Promise<ClaimedDeliveryBatch>;
  resetStaleDeliveries(minutes: number): Promise<void>;
  getApInboxStats(): Promise<{ pending: number; processed: number }>;
  getApDeliveryQueueStats(): Promise<{ pending: number; delivered: number; failed: number }>;
  countApRateLimits(): Promise<number>;

  // ActivityPub - Posts & Reactions
  findPostByApObjectId(ap_object_id: string): Promise<any | null>;
  createApReaction(input: ApReactionInput): Promise<any>;
  deleteApReactionsByActivityId(ap_activity_id: string): Promise<void>;
  createApRemotePost(input: ApRemotePostInput): Promise<{ id: string; inserted: boolean }>;
  createApRemoteComment(input: ApRemoteCommentInput): Promise<{ id: string; inserted: boolean }>;

  // ActivityPub - Announces
  findApAnnounce(activity_id: string): Promise<any | null>;
  createApAnnounce(input: ApAnnounceInput): Promise<any>;
  deleteApAnnouncesByActivityId(activity_id: string): Promise<void>;

  // ActivityPub - Actor Cache
  findApActor(id: string): Promise<any | null>;
  upsertApActor(actor: Record<string, any>): Promise<any>;

  // ActivityPub - Keypairs
  getApKeypair?(user_id: string): Promise<{ public_key_pem: string; private_key_pem: string } | null>;
  createApKeypair?(input: { user_id: string; public_key_pem: string; private_key_pem: string }): Promise<void>;

  // Reports
  createReport(report: ReportInput): Promise<any>;
  listReports(status?: string, limit?: number, offset?: number): Promise<any[]>;
  listReportsByUser?(reporterActorId: string, limit?: number, offset?: number): Promise<any[]>;
  updateReportStatus(id: string, status: string): Promise<void>;

  // Low-level operations (for complex queries)
  transaction<T>(fn: (tx: DatabaseAPI) => Promise<T>): Promise<T>;
  executeRaw(sql: string, ...params: any[]): Promise<number>;
  queryRaw<T = any>(sql: string, ...params: any[]): Promise<T[]>;

  // Raw query (deprecated, use queryRaw instead)
  query(sql: string, params?: any[]): Promise<any[]>;

  // Cleanup
  disconnect(): Promise<void>;
}

export interface ReportInput {
  id: string;
  reporter_actor_id: string;
  target_actor_id: string;
  target_object_id?: string | null;
  reason?: string;
  category?: string;
  status?: string;
  created_at?: string | Date;
  updated_at?: string | Date;
}
