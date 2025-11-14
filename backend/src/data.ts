// Database API wrapper for takos/backend
// Provides configurable data factories so downstream apps can inject their own DB layer.

/// <reference types="@cloudflare/workers-types" />

import { createDatabaseAPI } from "./lib/data";
import type { DatabaseAPI } from "./lib/types";
import { getPrisma } from "./prisma";
import type {
  AppContext,
  EnvWithDatabase,
  PublicAccountBindings,
} from "@takos/platform/server";

export type DataFactory = (
  env: EnvWithDatabase,
  context?: AppContext<PublicAccountBindings>,
) => DatabaseAPI;

// Instance-scoped database API that automatically injects instance_id from context
export interface InstanceScopedDatabaseAPI {
  // Instance-scoped methods without instance_id parameter
  getUser(id: string): Promise<any>;
  getUserByHandle(handle: string): Promise<any>;
  searchUsersByName(query: string, limit?: number): Promise<any[]>;
  createUser(user: any): Promise<any>;
  updateUser(id: string, fields: any): Promise<any>;
  renameUserId(oldId: string, newId: string): Promise<any>;
  
  getAccountByProvider(provider: string, providerAccountId: string): Promise<any>;
  createUserAccount(account: any): Promise<any>;
  updateAccountUser(provider: string, providerAccountId: string, user_id: string): Promise<any>;
  updateUserAccountPassword(accountId: string, newPasswordHash: string): Promise<any>;
  listAccountsByUser(user_id: string): Promise<any[]>;
  
  getUserJwtSecret(userId: string): Promise<string | null>;
  setUserJwtSecret(userId: string, secret: string): Promise<void>;
  
  getFriendRequest(requester_id: string, addressee_id: string): Promise<any>;
  getFriendshipBetween(user_id: string, other_id: string): Promise<any>;
  createFriendRequest(requester_id: string, addressee_id: string): Promise<any>;
  setFriendStatus(requester_id: string, addressee_id: string, status: any): Promise<any>;
  listFriendships(user_id: string, status?: any): Promise<any[]>;
  
  addNotification(notification: any): Promise<any>;
  listNotifications(user_id: string): Promise<any[]>;
  markNotificationRead(id: string): Promise<void>;
  countUnreadNotifications(user_id: string): Promise<number>;
  
  createCommunity(community: any): Promise<any>;
  getCommunity(id: string): Promise<any>;
  updateCommunity(id: string, fields: Record<string, any>): Promise<any>;
  setMembership(community_id: string, user_id: string, membership: any): Promise<void>;
  hasMembership(community_id: string, user_id: string): Promise<boolean>;
  listMembershipsByCommunity(community_id: string): Promise<any[]>;
  listUserCommunities(user_id: string): Promise<any[]>;
  listCommunityMembersWithUsers(community_id: string): Promise<any[]>;
  
  listChannelsByCommunity(community_id: string): Promise<any[]>;
  createChannel(community_id: string, channel: any): Promise<any>;
  getChannel(community_id: string, id: string): Promise<any>;
  deleteChannel(community_id: string, id: string): Promise<void>;
  
  createInvite(invite: any): Promise<any>;
  listInvites(community_id: string): Promise<any[]>;
  getInvite(code: string): Promise<any>;
  updateInvite(code: string, fields: Record<string, any>): Promise<any>;
  disableInvite(code: string): Promise<any>;
  resetInvites(community_id: string): Promise<void>;
  
  createMemberInvite(invite: any): Promise<any>;
  listMemberInvitesByCommunity(community_id: string): Promise<any[]>;
  listMemberInvitesForUser(user_id: string): Promise<any[]>;
  getMemberInvite(id: string): Promise<any>;
  setMemberInviteStatus(id: string, status: string): Promise<any>;
  
  createPost(post: any): Promise<any>;
  getPost(id: string): Promise<any>;
  listPostsByCommunity(community_id: string): Promise<any[]>;
  listGlobalPostsForUser(user_id: string): Promise<any[]>;
  updatePost(id: string, fields: Record<string, any>): Promise<any>;
  
  addReaction(reaction: any): Promise<any>;
  listReactionsByPost(post_id: string): Promise<any[]>;
  
  addComment(comment: any): Promise<any>;
  listCommentsByPost(post_id: string): Promise<any[]>;
  
  createStory(story: any): Promise<any>;
  getStory(id: string): Promise<any>;
  listStoriesByCommunity(community_id: string): Promise<any[]>;
  listGlobalStoriesForUser(user_id: string): Promise<any[]>;
  updateStory(id: string, fields: Record<string, any>): Promise<any>;
  deleteStory(id: string): Promise<void>;
  
  registerPushDevice(device: any): Promise<any>;
  listPushDevicesByUser(user_id: string): Promise<any[]>;
  removePushDevice(token: string): Promise<void>;
  
  createAccessToken(input: any): Promise<any>;
  getAccessTokenByHash(token_hash: string): Promise<any>;
  listAccessTokensByUser(user_id: string): Promise<any[]>;
  touchAccessToken(token_hash: string, fields?: any): Promise<void>;
  deleteAccessToken(token_hash: string): Promise<void>;
  
  upsertDmThread(participantsHash: string, participantsJson: string): Promise<any>;
  createDmMessage(threadId: string, authorId: string, contentHtml: string, rawActivity: any): Promise<any>;
  listDmMessages(threadId: string, limit?: number): Promise<any[]>;
  
  createChannelMessageRecord(communityId: string, channelId: string, authorId: string, contentHtml: string, rawActivity: any): Promise<any>;
  listChannelMessages(communityId: string, channelId: string, limit?: number): Promise<any[]>;
  
  // Session methods (for SessionStore compatibility)
  createSession(session: any): Promise<any>;
  getSession(id: string): Promise<any>;
  updateSession(id: string, data: Record<string, unknown>): Promise<any>;
  deleteSession(id: string): Promise<void>;
  
  // ActivityPub helpers
  upsertApOutboxActivity(input: any): Promise<any>;
  createApDeliveryQueueItem(input: any): Promise<any>;
  findApActor(id: string): Promise<any | null>;
  findApFollower(local_user_id: string, remote_actor_id: string): Promise<any | null>;

  // ActivityPub - Keypairs
  getApKeypair(user_id: string): Promise<{ public_key_pem: string; private_key_pem: string } | null>;

  // ActivityPub - Outbox stats
  countApOutboxActivities(local_user_id: string): Promise<number>;
  listApOutboxActivitiesPage(local_user_id: string, limit: number, offset: number): Promise<any[]>;
  countPostsByCommunity(community_id: string): Promise<number>;
  listPostsByCommunityPage(community_id: string, limit: number, offset: number): Promise<any[]>;
  getPostWithAuthor(post_id: string, author_id: string): Promise<any | null>;

  // ActivityPub - Rate Limiting
  deleteOldRateLimits(key: string, windowStart: number): Promise<void>;
  countRateLimits(key: string, windowStart: number): Promise<{ count: number; oldestWindow: number }>;
  createRateLimitEntry(id: string, key: string, windowStart: number, createdAt: number): Promise<void>;

  // Host-level methods (no instance_id)
  getHostUserById(id: string): Promise<any>;
  getHostUserByProvider(provider: string, provider_id: string): Promise<any>;
  getHostUserByEmail(email: string): Promise<any>;
  createHostUser(user: any): Promise<any>;
  updateHostUser(id: string, fields: any): Promise<any>;
  
  getInstanceOwnership(instance_id: string, host_user_id: string): Promise<any>;
  createInstanceOwnership(ownership: any): Promise<any>;
  listInstancesByHostUser(host_user_id: string): Promise<any[]>;
  listHostUsersByInstance(instance_id: string): Promise<any[]>;
  
  query(sql: string, params?: any[]): Promise<any[]>;
  disconnect(): Promise<void>;
}

/**
 * Wraps a DatabaseAPI to automatically inject instance_id from the app context
 */
function wrapWithInstanceScope(
  api: DatabaseAPI,
  context?: AppContext<PublicAccountBindings>,
): InstanceScopedDatabaseAPI {
  const getInstanceId = (): string => {
    if (!context) {
      throw new Error("Cannot determine instance_id: no context provided");
    }
    const instanceHandle = (context as any).get?.("instanceHandle");
    if (!instanceHandle || typeof instanceHandle !== "string") {
      throw new Error(`Cannot determine instance_id: instanceHandle is ${instanceHandle}`);
    }
    return instanceHandle;
  };

  return {
    // Instance-scoped methods - automatically inject instance_id
    getUser: (id: string) => api.getUser(getInstanceId(), id),
    getUserByHandle: (handle: string) => api.getUserByHandle(getInstanceId(), handle),
    searchUsersByName: (query: string, limit?: number) => api.searchUsersByName(getInstanceId(), query, limit),
    createUser: (user: any) => api.createUser(getInstanceId(), user),
    updateUser: (id: string, fields: any) => api.updateUser(getInstanceId(), id, fields),
    renameUserId: (oldId: string, newId: string) => api.renameUserId(getInstanceId(), oldId, newId),
    
    getAccountByProvider: (provider: string, providerAccountId: string) => 
      api.getAccountByProvider(getInstanceId(), provider, providerAccountId),
    createUserAccount: (account: any) => api.createUserAccount(getInstanceId(), account),
    updateAccountUser: (provider: string, providerAccountId: string, user_id: string) => 
      api.updateAccountUser(getInstanceId(), provider, providerAccountId, user_id),
    updateUserAccountPassword: (accountId: string, newPasswordHash: string) => 
      api.updateUserAccountPassword(getInstanceId(), accountId, newPasswordHash),
    listAccountsByUser: (user_id: string) => api.listAccountsByUser(getInstanceId(), user_id),
    
    getUserJwtSecret: (userId: string) => api.getUserJwtSecret(getInstanceId(), userId),
    setUserJwtSecret: (userId: string, secret: string) => api.setUserJwtSecret(getInstanceId(), userId, secret),
    
    getFriendRequest: (requester_id: string, addressee_id: string) => 
      api.getFriendRequest(getInstanceId(), requester_id, addressee_id),
    getFriendshipBetween: (user_id: string, other_id: string) => 
      api.getFriendshipBetween(getInstanceId(), user_id, other_id),
    createFriendRequest: (requester_id: string, addressee_id: string) => 
      api.createFriendRequest(getInstanceId(), requester_id, addressee_id),
    setFriendStatus: (requester_id: string, addressee_id: string, status: any) => 
      api.setFriendStatus(getInstanceId(), requester_id, addressee_id, status),
    listFriendships: (user_id: string, status?: any) => 
      api.listFriendships(getInstanceId(), user_id, status),
    
    addNotification: (notification: any) => api.addNotification(getInstanceId(), notification),
    listNotifications: (user_id: string) => api.listNotifications(getInstanceId(), user_id),
    markNotificationRead: (id: string) => api.markNotificationRead(getInstanceId(), id),
    countUnreadNotifications: (user_id: string) => api.countUnreadNotifications(getInstanceId(), user_id),
    
    createCommunity: (community: any) => api.createCommunity(getInstanceId(), community),
    getCommunity: (id: string) => api.getCommunity(getInstanceId(), id),
    updateCommunity: (id: string, fields: Record<string, any>) => api.updateCommunity(getInstanceId(), id, fields),
    setMembership: (community_id: string, user_id: string, membership: any) => 
      api.setMembership(getInstanceId(), community_id, user_id, membership),
    hasMembership: (community_id: string, user_id: string) => 
      api.hasMembership(getInstanceId(), community_id, user_id),
    listMembershipsByCommunity: (community_id: string) => 
      api.listMembershipsByCommunity(getInstanceId(), community_id),
    listUserCommunities: (user_id: string) => api.listUserCommunities(getInstanceId(), user_id),
    listCommunityMembersWithUsers: (community_id: string) => 
      api.listCommunityMembersWithUsers(getInstanceId(), community_id),
    
    listChannelsByCommunity: (community_id: string) => api.listChannelsByCommunity(getInstanceId(), community_id),
    createChannel: (community_id: string, channel: any) => 
      api.createChannel(getInstanceId(), community_id, channel),
    getChannel: (community_id: string, id: string) => api.getChannel(getInstanceId(), community_id, id),
    deleteChannel: (community_id: string, id: string) => api.deleteChannel(getInstanceId(), community_id, id),
    
    createInvite: (invite: any) => api.createInvite(getInstanceId(), invite),
    listInvites: (community_id: string) => api.listInvites(getInstanceId(), community_id),
    getInvite: (code: string) => api.getInvite(getInstanceId(), code),
    updateInvite: (code: string, fields: Record<string, any>) => api.updateInvite(getInstanceId(), code, fields),
    disableInvite: (code: string) => api.disableInvite(getInstanceId(), code),
    resetInvites: (community_id: string) => api.resetInvites(getInstanceId(), community_id),
    
    createMemberInvite: (invite: any) => api.createMemberInvite(getInstanceId(), invite),
    listMemberInvitesByCommunity: (community_id: string) => 
      api.listMemberInvitesByCommunity(getInstanceId(), community_id),
    listMemberInvitesForUser: (user_id: string) => api.listMemberInvitesForUser(getInstanceId(), user_id),
    getMemberInvite: (id: string) => api.getMemberInvite(getInstanceId(), id),
    setMemberInviteStatus: (id: string, status: string) => api.setMemberInviteStatus(getInstanceId(), id, status),
    
    createPost: (post: any) => api.createPost(getInstanceId(), post),
    getPost: (id: string) => api.getPost(getInstanceId(), id),
    listPostsByCommunity: (community_id: string) => api.listPostsByCommunity(getInstanceId(), community_id),
    listGlobalPostsForUser: (user_id: string) => api.listGlobalPostsForUser(getInstanceId(), user_id),
    updatePost: (id: string, fields: Record<string, any>) => api.updatePost(getInstanceId(), id, fields),
    
    addReaction: (reaction: any) => api.addReaction(getInstanceId(), reaction),
    listReactionsByPost: (post_id: string) => api.listReactionsByPost(getInstanceId(), post_id),
    
    addComment: (comment: any) => api.addComment(getInstanceId(), comment),
    listCommentsByPost: (post_id: string) => api.listCommentsByPost(getInstanceId(), post_id),
    
    createStory: (story: any) => api.createStory(getInstanceId(), story),
    getStory: (id: string) => api.getStory(getInstanceId(), id),
    listStoriesByCommunity: (community_id: string) => api.listStoriesByCommunity(getInstanceId(), community_id),
    listGlobalStoriesForUser: (user_id: string) => api.listGlobalStoriesForUser(getInstanceId(), user_id),
    updateStory: (id: string, fields: Record<string, any>) => api.updateStory(getInstanceId(), id, fields),
    deleteStory: (id: string) => api.deleteStory(getInstanceId(), id),
    
    registerPushDevice: (device: any) => api.registerPushDevice(getInstanceId(), device),
    listPushDevicesByUser: (user_id: string) => api.listPushDevicesByUser(getInstanceId(), user_id),
    removePushDevice: (token: string) => api.removePushDevice(getInstanceId(), token),
    
    createAccessToken: (input: any) => api.createAccessToken(getInstanceId(), input),
    getAccessTokenByHash: (token_hash: string) => api.getAccessTokenByHash(getInstanceId(), token_hash),
    listAccessTokensByUser: (user_id: string) => api.listAccessTokensByUser(getInstanceId(), user_id),
    touchAccessToken: (token_hash: string, fields?: any) => 
      api.touchAccessToken(getInstanceId(), token_hash, fields),
    deleteAccessToken: (token_hash: string) => api.deleteAccessToken(getInstanceId(), token_hash),
    
    upsertDmThread: (participantsHash: string, participantsJson: string) => 
      api.upsertDmThread(getInstanceId(), participantsHash, participantsJson),
    createDmMessage: (threadId: string, authorId: string, contentHtml: string, rawActivity: any) => 
      api.createDmMessage(getInstanceId(), threadId, authorId, contentHtml, rawActivity),
    listDmMessages: (threadId: string, limit?: number) => api.listDmMessages(getInstanceId(), threadId, limit),
    
    createChannelMessageRecord: (communityId: string, channelId: string, authorId: string, contentHtml: string, rawActivity: any) => 
      api.createChannelMessageRecord(getInstanceId(), communityId, channelId, authorId, contentHtml, rawActivity),
    listChannelMessages: (communityId: string, channelId: string, limit?: number) => 
      api.listChannelMessages(getInstanceId(), communityId, channelId, limit),
    
    // Session methods
    createSession: (session: any) => api.createSession(getInstanceId(), session),
    getSession: (id: string) => api.getSession(getInstanceId(), id),
    updateSession: (id: string, data: Record<string, unknown>) => api.updateSession(getInstanceId(), id, data),
    deleteSession: (id: string) => api.deleteSession(getInstanceId(), id),
    
    upsertApOutboxActivity: (input: any) => api.upsertApOutboxActivity(input),
    createApDeliveryQueueItem: (input: any) => api.createApDeliveryQueueItem(input),
    findApActor: api.findApActor,
    findApFollower: api.findApFollower,

    // ActivityPub - Keypairs
    getApKeypair: api.getApKeypair,

    // ActivityPub - Outbox stats
    countApOutboxActivities: api.countApOutboxActivities,
    listApOutboxActivitiesPage: api.listApOutboxActivitiesPage,
    countPostsByCommunity: api.countPostsByCommunity,
    listPostsByCommunityPage: api.listPostsByCommunityPage,
    getPostWithAuthor: api.getPostWithAuthor,

    // ActivityPub - Rate Limiting
    deleteOldRateLimits: api.deleteOldRateLimits,
    countRateLimits: api.countRateLimits,
    createRateLimitEntry: api.createRateLimitEntry,

    // Host-level methods (pass through without instance_id)
    getHostUserById: api.getHostUserById,
    getHostUserByProvider: api.getHostUserByProvider,
    getHostUserByEmail: api.getHostUserByEmail,
    createHostUser: api.createHostUser,
    updateHostUser: api.updateHostUser,
    
    getInstanceOwnership: api.getInstanceOwnership,
    createInstanceOwnership: api.createInstanceOwnership,
    listInstancesByHostUser: api.listInstancesByHostUser,
    listHostUsersByInstance: api.listHostUsersByInstance,
    
    query: api.query,
    disconnect: api.disconnect,
  };
}

let currentFactory: DataFactory = (env) =>
  createDatabaseAPI({
    DB: env.DB,
    createPrismaClient: getPrisma,
  });

/**
 * Creates a database API instance for the takos backend.
 * Uses the currently configured factory (defaults to Prisma+D1).
 * Automatically wraps the API to inject instance_id from context.
 */
export function makeData(
  env: EnvWithDatabase,
  context?: AppContext<PublicAccountBindings>,
): InstanceScopedDatabaseAPI {
  const rawApi = currentFactory(env, context);
  return wrapWithInstanceScope(rawApi, context);
}

/**
 * Replace the database factory used by `makeData`.
 */
export function setBackendDataFactory(factory: DataFactory): void {
  currentFactory = factory;
}

/**
 * Returns the built-in data factory (Prisma + Cloudflare D1).
 */
export function getDefaultDataFactory(): DataFactory {
  return (env) =>
    createDatabaseAPI({
      DB: env.DB,
      createPrismaClient: getPrisma,
    });
}
