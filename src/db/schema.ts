/**
 * Drizzle ORM Schema for Yurucommu
 *
 * This file re-exports all schema definitions from domain-specific modules
 * under ./schema/. See individual files for table definitions:
 * - schema/actors.ts: actors, actorCache, instanceActor, sessions
 * - schema/posts.ts: objects, likes, announces, bookmarks, objectRecipients
 * - schema/social.ts: follows, blocks, mutes
 * - schema/communities.ts: communities, communityMembers, communityJoinRequests, communityInvites
 * - schema/stories.ts: storyViews, storyVotes, storyShares
 * - schema/messaging.ts: activities, deliveryQueue, deliveryCircuit, inbox, notificationArchived, dm*, dmCommunityReadStatus, mediaUploads
 * - schema/relations.ts: all Drizzle relation definitions
 */

export * from "./schema/index.ts";
