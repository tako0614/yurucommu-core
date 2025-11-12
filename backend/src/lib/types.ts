/// <reference types="@cloudflare/workers-types" />

/**
 * Database API interface with multi-tenant support
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

// Host user management (tenant-independent)
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

export interface TenantOwnershipInput {
  tenant_id: string;
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
 * Complete Database API interface with tenant support
 */
export interface DatabaseAPI {
  // Host Users (tenant-independent)
  getHostUserById(id: string): Promise<any>;
  getHostUserByProvider(provider: string, provider_id: string): Promise<any>;
  getHostUserByEmail(email: string): Promise<any>;
  createHostUser(user: HostUserInput): Promise<any>;
  updateHostUser(id: string, fields: Partial<HostUserInput>): Promise<any>;

  // Tenant Ownerships
  getTenantOwnership(tenant_id: string, host_user_id: string): Promise<any>;
  createTenantOwnership(ownership: TenantOwnershipInput): Promise<any>;
  listTenantsByHostUser(host_user_id: string): Promise<any[]>;
  listHostUsersByTenant(tenant_id: string): Promise<any[]>;

  // Users (tenant-scoped)
  getUser(tenant_id: string, id: string): Promise<any>;
  getUserByHandle(tenant_id: string, handle: string): Promise<any>;
  searchUsersByName(tenant_id: string, query: string, limit?: number): Promise<any[]>;
  createUser(tenant_id: string, user: UserInput): Promise<any>;
  updateUser(tenant_id: string, id: string, fields: UserUpdateFields): Promise<any>;
  renameUserId(tenant_id: string, oldId: string, newId: string): Promise<any>;

  // User Accounts (tenant-scoped)
  getAccountByProvider(tenant_id: string, provider: string, providerAccountId: string): Promise<any>;
  createUserAccount(tenant_id: string, account: UserAccountInput): Promise<any>;
  updateAccountUser(tenant_id: string, provider: string, providerAccountId: string, user_id: string): Promise<any>;
  updateUserAccountPassword(tenant_id: string, accountId: string, newPasswordHash: string): Promise<any>;
  listAccountsByUser(tenant_id: string, user_id: string): Promise<any[]>;

  // JWT (tenant-scoped)
  getUserJwtSecret(tenant_id: string, userId: string): Promise<string | null>;
  setUserJwtSecret(tenant_id: string, userId: string, secret: string): Promise<void>;

  // Friendships (tenant-scoped)
  getFriendRequest(tenant_id: string, requester_id: string, addressee_id: string): Promise<any>;
  getFriendshipBetween(tenant_id: string, user_id: string, other_id: string): Promise<any>;
  createFriendRequest(tenant_id: string, requester_id: string, addressee_id: string): Promise<any>;
  setFriendStatus(tenant_id: string, requester_id: string, addressee_id: string, status: FriendStatus): Promise<any>;
  listFriendships(tenant_id: string, user_id: string, status?: FriendStatus | null): Promise<any[]>;

  // Notifications (tenant-scoped)
  addNotification(tenant_id: string, notification: NotificationInput): Promise<any>;
  listNotifications(tenant_id: string, user_id: string): Promise<any[]>;
  markNotificationRead(tenant_id: string, id: string): Promise<void>;
  countUnreadNotifications(tenant_id: string, user_id: string): Promise<number>;

  // Communities & Memberships (tenant-scoped)
  createCommunity(tenant_id: string, community: CommunityInput): Promise<any>;
  getCommunity(tenant_id: string, id: string): Promise<any>;
  updateCommunity(tenant_id: string, id: string, fields: Record<string, any>): Promise<any>;
  setMembership(tenant_id: string, community_id: string, user_id: string, membership: MembershipInput): Promise<void>;
  hasMembership(tenant_id: string, community_id: string, user_id: string): Promise<boolean>;
  listMembershipsByCommunity(tenant_id: string, community_id: string): Promise<any[]>;
  listUserCommunities(tenant_id: string, user_id: string): Promise<any[]>;
  listCommunityMembersWithUsers(tenant_id: string, community_id: string): Promise<any[]>;

  // Channels (tenant-scoped)
  listChannelsByCommunity(tenant_id: string, community_id: string): Promise<any[]>;
  createChannel(tenant_id: string, community_id: string, channel: ChannelInput): Promise<any>;
  getChannel(tenant_id: string, community_id: string, id: string): Promise<any>;
  deleteChannel(tenant_id: string, community_id: string, id: string): Promise<void>;

  // Invites (tenant-scoped)
  createInvite(tenant_id: string, invite: InviteInput): Promise<any>;
  listInvites(tenant_id: string, community_id: string): Promise<any[]>;
  getInvite(tenant_id: string, code: string): Promise<any>;
  updateInvite(tenant_id: string, code: string, fields: Record<string, any>): Promise<any>;
  disableInvite(tenant_id: string, code: string): Promise<any>;
  resetInvites(tenant_id: string, community_id: string): Promise<void>;

  // Member Invites (tenant-scoped)
  createMemberInvite(tenant_id: string, invite: MemberInviteInput): Promise<any>;
  listMemberInvitesByCommunity(tenant_id: string, community_id: string): Promise<any[]>;
  listMemberInvitesForUser(tenant_id: string, user_id: string): Promise<any[]>;
  getMemberInvite(tenant_id: string, id: string): Promise<any>;
  setMemberInviteStatus(tenant_id: string, id: string, status: string): Promise<any>;

  // Posts (tenant-scoped)
  createPost(tenant_id: string, post: PostInput): Promise<any>;
  getPost(tenant_id: string, id: string): Promise<any>;
  listPostsByCommunity(tenant_id: string, community_id: string): Promise<any[]>;
  listGlobalPostsForUser(tenant_id: string, user_id: string): Promise<any[]>;
  updatePost(tenant_id: string, id: string, fields: Record<string, any>): Promise<any>;

  // Reactions (tenant-scoped)
  addReaction(tenant_id: string, reaction: ReactionInput): Promise<any>;
  listReactionsByPost(tenant_id: string, post_id: string): Promise<any[]>;

  // Comments (tenant-scoped)
  addComment(tenant_id: string, comment: CommentInput): Promise<any>;
  listCommentsByPost(tenant_id: string, post_id: string): Promise<any[]>;

  // Stories (tenant-scoped)
  createStory(tenant_id: string, story: StoryInput): Promise<any>;
  getStory(tenant_id: string, id: string): Promise<any>;
  listStoriesByCommunity(tenant_id: string, community_id: string): Promise<any[]>;
  listGlobalStoriesForUser(tenant_id: string, user_id: string): Promise<any[]>;
  updateStory(tenant_id: string, id: string, fields: Record<string, any>): Promise<any>;
  deleteStory(tenant_id: string, id: string): Promise<void>;

  // Push Devices (tenant-scoped)
  registerPushDevice(tenant_id: string, device: PushDeviceInput): Promise<any>;
  listPushDevicesByUser(tenant_id: string, user_id: string): Promise<any[]>;
  removePushDevice(tenant_id: string, token: string): Promise<void>;

  // Access Tokens (tenant-scoped)
  createAccessToken(tenant_id: string, input: AccessTokenInput): Promise<any>;
  getAccessTokenByHash(tenant_id: string, token_hash: string): Promise<any>;
  listAccessTokensByUser(tenant_id: string, user_id: string): Promise<any[]>;
  touchAccessToken(tenant_id: string, token_hash: string, fields?: AccessTokenTouchFields): Promise<void>;
  deleteAccessToken(tenant_id: string, token_hash: string): Promise<void>;

  // Chat - DM (tenant-scoped)
  upsertDmThread(tenant_id: string, participantsHash: string, participantsJson: string): Promise<any>;
  createDmMessage(tenant_id: string, threadId: string, authorId: string, contentHtml: string, rawActivity: any): Promise<any>;
  listDmMessages(tenant_id: string, threadId: string, limit?: number): Promise<any[]>;

  // Chat - Channel (tenant-scoped)
  createChannelMessageRecord(tenant_id: string, communityId: string, channelId: string, authorId: string, contentHtml: string, rawActivity: any): Promise<any>;
  listChannelMessages(tenant_id: string, communityId: string, channelId: string, limit?: number): Promise<any[]>;

  // Sessions (tenant-scoped)
  createSession(tenant_id: string, session: SessionInput): Promise<any>;
  getSession(tenant_id: string, id: string): Promise<any>;
  updateSession(tenant_id: string, id: string, data: SessionUpdateData): Promise<any>;
  deleteSession(tenant_id: string, id: string): Promise<void>;

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
