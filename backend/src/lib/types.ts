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
  media_urls?: string[];
  created_at: string | Date;
  pinned?: boolean;
  broadcast_all?: boolean;
  visible_to_friends?: boolean;
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

export interface CommentInput {
  id: string;
  post_id: string;
  author_id: string;
  text: string;
  created_at: string | Date;
  ap_object_id?: string | null;
  ap_activity_id?: string | null;
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

export interface AccessTokenInput {
  id?: string;
  user_id: string;
  token_hash: string;
  label?: string;
  expires_at?: string | Date | null;
}

export interface AccessTokenTouchFields {
  last_used_at?: string | Date | null;
  expires_at?: string | Date | null;
}

// Host user management (instance-independent)
export interface HostUserInput {
  id?: string;
  email: string;
  name: string;
  picture?: string;
  provider: string;
  provider_id: string;
  created_at?: string | Date;
  updated_at?: string | Date;
}

export interface InstanceOwnershipInput {
  instance_id: string;
  host_user_id: string;
  role?: string;
  created_at?: string | Date;
}

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
  created_at?: string | Date;
  type?: string;
  media_urls?: string[];
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
  // Host Users (instance-independent)
  getHostUserById(id: string): Promise<any>;
  getHostUserByProvider(provider: string, provider_id: string): Promise<any>;
  getHostUserByEmail(email: string): Promise<any>;
  createHostUser(user: HostUserInput): Promise<any>;
  updateHostUser(id: string, fields: Partial<HostUserInput>): Promise<any>;

  // Instance Ownerships
  getInstanceOwnership(instance_id: string, host_user_id: string): Promise<any>;
  createInstanceOwnership(ownership: InstanceOwnershipInput): Promise<any>;
  listInstancesByHostUser(host_user_id: string): Promise<any[]>;
  listHostUsersByInstance(instance_id: string): Promise<any[]>;

  // Users (instance-scoped)
  getUser(instance_id: string, id: string): Promise<any>;
  getUserByHandle(instance_id: string, handle: string): Promise<any>;
  searchUsersByName(instance_id: string, query: string, limit?: number): Promise<any[]>;
  createUser(instance_id: string, user: UserInput): Promise<any>;
  updateUser(instance_id: string, id: string, fields: UserUpdateFields): Promise<any>;
  renameUserId(instance_id: string, oldId: string, newId: string): Promise<any>;

  // User Accounts (instance-scoped)
  getAccountByProvider(instance_id: string, provider: string, providerAccountId: string): Promise<any>;
  createUserAccount(instance_id: string, account: UserAccountInput): Promise<any>;
  updateAccountUser(instance_id: string, provider: string, providerAccountId: string, user_id: string): Promise<any>;
  updateUserAccountPassword(instance_id: string, accountId: string, newPasswordHash: string): Promise<any>;
  listAccountsByUser(instance_id: string, user_id: string): Promise<any[]>;

  // JWT (instance-scoped)
  getUserJwtSecret(instance_id: string, userId: string): Promise<string | null>;
  setUserJwtSecret(instance_id: string, userId: string, secret: string): Promise<void>;

  // Friendships (instance-scoped)
  getFriendRequest(instance_id: string, requester_id: string, addressee_id: string): Promise<any>;
  getFriendshipBetween(instance_id: string, user_id: string, other_id: string): Promise<any>;
  createFriendRequest(instance_id: string, requester_id: string, addressee_id: string): Promise<any>;
  setFriendStatus(instance_id: string, requester_id: string, addressee_id: string, status: FriendStatus): Promise<any>;
  listFriendships(instance_id: string, user_id: string, status?: FriendStatus | null): Promise<any[]>;

  // Notifications (instance-scoped)
  addNotification(instance_id: string, notification: NotificationInput): Promise<any>;
  listNotifications(instance_id: string, user_id: string): Promise<any[]>;
  markNotificationRead(instance_id: string, id: string): Promise<void>;
  countUnreadNotifications(instance_id: string, user_id: string): Promise<number>;

  // Communities & Memberships (instance-scoped)
  createCommunity(instance_id: string, community: CommunityInput): Promise<any>;
  getCommunity(instance_id: string, id: string): Promise<any>;
  updateCommunity(instance_id: string, id: string, fields: Record<string, any>): Promise<any>;
  setMembership(instance_id: string, community_id: string, user_id: string, membership: MembershipInput): Promise<void>;
  hasMembership(instance_id: string, community_id: string, user_id: string): Promise<boolean>;
  listMembershipsByCommunity(instance_id: string, community_id: string): Promise<any[]>;
  listUserCommunities(instance_id: string, user_id: string): Promise<any[]>;
  listCommunityMembersWithUsers(instance_id: string, community_id: string): Promise<any[]>;

  // Channels (instance-scoped)
  listChannelsByCommunity(instance_id: string, community_id: string): Promise<any[]>;
  createChannel(instance_id: string, community_id: string, channel: ChannelInput): Promise<any>;
  getChannel(instance_id: string, community_id: string, id: string): Promise<any>;
  deleteChannel(instance_id: string, community_id: string, id: string): Promise<void>;

  // Invites (instance-scoped)
  createInvite(instance_id: string, invite: InviteInput): Promise<any>;
  listInvites(instance_id: string, community_id: string): Promise<any[]>;
  getInvite(instance_id: string, code: string): Promise<any>;
  updateInvite(instance_id: string, code: string, fields: Record<string, any>): Promise<any>;
  disableInvite(instance_id: string, code: string): Promise<any>;
  resetInvites(instance_id: string, community_id: string): Promise<void>;

  // Member Invites (instance-scoped)
  createMemberInvite(instance_id: string, invite: MemberInviteInput): Promise<any>;
  listMemberInvitesByCommunity(instance_id: string, community_id: string): Promise<any[]>;
  listMemberInvitesForUser(instance_id: string, user_id: string): Promise<any[]>;
  getMemberInvite(instance_id: string, id: string): Promise<any>;
  setMemberInviteStatus(instance_id: string, id: string, status: string): Promise<any>;

  // Posts (instance-scoped)
  createPost(instance_id: string, post: PostInput): Promise<any>;
  getPost(instance_id: string, id: string): Promise<any>;
  listPostsByCommunity(instance_id: string, community_id: string): Promise<any[]>;
  listGlobalPostsForUser(instance_id: string, user_id: string): Promise<any[]>;
  updatePost(instance_id: string, id: string, fields: Record<string, any>): Promise<any>;

  // Reactions (instance-scoped)
  addReaction(instance_id: string, reaction: ReactionInput): Promise<any>;
  listReactionsByPost(instance_id: string, post_id: string): Promise<any[]>;

  // Comments (instance-scoped)
  addComment(instance_id: string, comment: CommentInput): Promise<any>;
  listCommentsByPost(instance_id: string, post_id: string): Promise<any[]>;

  // Stories (instance-scoped)
  createStory(instance_id: string, story: StoryInput): Promise<any>;
  getStory(instance_id: string, id: string): Promise<any>;
  listStoriesByCommunity(instance_id: string, community_id: string): Promise<any[]>;
  listGlobalStoriesForUser(instance_id: string, user_id: string): Promise<any[]>;
  updateStory(instance_id: string, id: string, fields: Record<string, any>): Promise<any>;
  deleteStory(instance_id: string, id: string): Promise<void>;

  // Push Devices (instance-scoped)
  registerPushDevice(instance_id: string, device: PushDeviceInput): Promise<any>;
  listPushDevicesByUser(instance_id: string, user_id: string): Promise<any[]>;
  removePushDevice(instance_id: string, token: string): Promise<void>;

  // Access Tokens (instance-scoped)
  createAccessToken(instance_id: string, input: AccessTokenInput): Promise<any>;
  getAccessTokenByHash(instance_id: string, token_hash: string): Promise<any>;
  listAccessTokensByUser(instance_id: string, user_id: string): Promise<any[]>;
  touchAccessToken(instance_id: string, token_hash: string, fields?: AccessTokenTouchFields): Promise<void>;
  deleteAccessToken(instance_id: string, token_hash: string): Promise<void>;

  // Chat - DM (instance-scoped)
  upsertDmThread(instance_id: string, participantsHash: string, participantsJson: string): Promise<any>;
  createDmMessage(instance_id: string, threadId: string, authorId: string, contentHtml: string, rawActivity: any): Promise<any>;
  listDmMessages(instance_id: string, threadId: string, limit?: number): Promise<any[]>;

  // Chat - Channel (instance-scoped)
  createChannelMessageRecord(instance_id: string, communityId: string, channelId: string, authorId: string, contentHtml: string, rawActivity: any): Promise<any>;
  listChannelMessages(instance_id: string, communityId: string, channelId: string, limit?: number): Promise<any[]>;

  // Sessions (instance-scoped)
  createSession(instance_id: string, session: SessionInput): Promise<any>;
  getSession(instance_id: string, id: string): Promise<any>;
  updateSession(instance_id: string, id: string, data: SessionUpdateData): Promise<any>;
  deleteSession(instance_id: string, id: string): Promise<void>;

  // ActivityPub - Followers
  upsertApFollower(input: ApFollowerInput): Promise<any>;
  deleteApFollowers(local_user_id: string, remote_actor_id: string): Promise<void>;
  findApFollower(local_user_id: string, remote_actor_id: string): Promise<any | null>;
  countApFollowers(local_user_id: string, status?: string): Promise<number>;
  listApFollowers(
    local_user_id: string,
    status?: string,
    limit?: number,
    offset?: number,
  ): Promise<Array<{ remote_actor_id: string }>>;

  // ActivityPub - Follows
  updateApFollowsStatus(local_user_id: string, remote_actor_id: string, status: string, accepted_at?: Date): Promise<void>;
  countApFollows(local_user_id: string, status?: string): Promise<number>;
  listApFollows(
    local_user_id: string,
    status?: string,
    limit?: number,
    offset?: number,
  ): Promise<Array<{ remote_actor_id: string }>>;

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

  // ActivityPub - Rate Limiting
  deleteOldRateLimits(key: string, windowStart: number): Promise<void>;
  countRateLimits(key: string, windowStart: number): Promise<{ count: number; oldestWindow: number }>;
  createRateLimitEntry(id: string, key: string, windowStart: number, createdAt: number): Promise<void>;

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
  getApKeypair(user_id: string): Promise<{ public_key_pem: string; private_key_pem: string } | null>;

  // ActivityPub - Outbox stats
  countApOutboxActivities(local_user_id: string): Promise<number>;
  listApOutboxActivitiesPage(local_user_id: string, limit: number, offset: number): Promise<any[]>;
  countPostsByCommunity(community_id: string): Promise<number>;
  listPostsByCommunityPage(community_id: string, limit: number, offset: number): Promise<any[]>;
  getPostWithAuthor(post_id: string, author_id: string): Promise<any | null>;

  // Low-level operations (for complex queries)
  transaction<T>(fn: (tx: DatabaseAPI) => Promise<T>): Promise<T>;
  executeRaw(sql: string, ...params: any[]): Promise<number>;
  queryRaw<T = any>(sql: string, ...params: any[]): Promise<T[]>;

  // Raw query (deprecated, use queryRaw instead)
  query(sql: string, params?: any[]): Promise<any[]>;

  // Cleanup
  disconnect(): Promise<void>;
}
