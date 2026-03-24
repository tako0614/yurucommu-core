/**
 * Drizzle ORM Relations definitions
 */

import { relations } from "drizzle-orm";
import { actors, actorCache, sessions } from "./actors";
import { objects, likes, announces, bookmarks, objectRecipients } from "./posts";
import { follows, blocks, mutes } from "./social";
import { communities, communityMembers, communityJoinRequests, communityInvites } from "./communities";
import { storyViews, storyVotes, storyShares } from "./stories";
import { activities, inbox } from "./messaging";

// ===========================================================================
// RELATIONS
// ===========================================================================

export const actorsRelations = relations(actors, ({ many }) => ({
  sessions: many(sessions),
  objectsAuthored: many(objects),
  followsAsFollower: many(follows, { relationName: "followerFollows" }),
  followsAsFollowing: many(follows, { relationName: "followingFollows" }),
  likes: many(likes),
  announces: many(announces),
  bookmarks: many(bookmarks),
  blocksAsBlocker: many(blocks, { relationName: "blockerBlocks" }),
  blocksAsBlocked: many(blocks, { relationName: "blockedBlocks" }),
  mutesAsMuter: many(mutes, { relationName: "muterMutes" }),
  mutesAsMuted: many(mutes, { relationName: "mutedMutes" }),
  activities: many(activities),
  storyViews: many(storyViews),
  storyVotes: many(storyVotes),
  storyShares: many(storyShares),
  communityMemberships: many(communityMembers),
  communityJoinRequests: many(communityJoinRequests),
  communityInvites: many(communityInvites),
  inboxItems: many(inbox),
  objectRecipients: many(objectRecipients),
}));

export const objectsRelations = relations(objects, ({ one, many }) => ({
  author: one(actors, {
    fields: [objects.attributedTo],
    references: [actors.apId],
  }),
  community: one(communities, {
    fields: [objects.communityApId],
    references: [communities.apId],
  }),
  likes: many(likes),
  announces: many(announces),
  bookmarks: many(bookmarks),
  storyViews: many(storyViews),
  storyVotes: many(storyVotes),
  storyShares: many(storyShares),
  recipients: many(objectRecipients),
  activities: many(activities),
}));

export const followsRelations = relations(follows, ({ one }) => ({
  follower: one(actors, {
    fields: [follows.followerApId],
    references: [actors.apId],
    relationName: "followerFollows",
  }),
  following: one(actors, {
    fields: [follows.followingApId],
    references: [actors.apId],
    relationName: "followingFollows",
  }),
}));

export const likesRelations = relations(likes, ({ one }) => ({
  actor: one(actors, {
    fields: [likes.actorApId],
    references: [actors.apId],
  }),
  object: one(objects, {
    fields: [likes.objectApId],
    references: [objects.apId],
  }),
}));

export const announcesRelations = relations(announces, ({ one }) => ({
  actor: one(actors, {
    fields: [announces.actorApId],
    references: [actors.apId],
  }),
  object: one(objects, {
    fields: [announces.objectApId],
    references: [objects.apId],
  }),
}));

export const bookmarksRelations = relations(bookmarks, ({ one }) => ({
  actor: one(actors, {
    fields: [bookmarks.actorApId],
    references: [actors.apId],
  }),
  object: one(objects, {
    fields: [bookmarks.objectApId],
    references: [objects.apId],
  }),
}));

export const blocksRelations = relations(blocks, ({ one }) => ({
  blocker: one(actors, {
    fields: [blocks.blockerApId],
    references: [actors.apId],
    relationName: "blockerBlocks",
  }),
  blocked: one(actors, {
    fields: [blocks.blockedApId],
    references: [actors.apId],
    relationName: "blockedBlocks",
  }),
}));

export const mutesRelations = relations(mutes, ({ one }) => ({
  muter: one(actors, {
    fields: [mutes.muterApId],
    references: [actors.apId],
    relationName: "muterMutes",
  }),
  muted: one(actors, {
    fields: [mutes.mutedApId],
    references: [actors.apId],
    relationName: "mutedMutes",
  }),
}));

export const activitiesRelations = relations(activities, ({ one, many }) => ({
  actor: one(actors, {
    fields: [activities.actorApId],
    references: [actors.apId],
  }),
  object: one(objects, {
    fields: [activities.objectApId],
    references: [objects.apId],
  }),
  inboxItems: many(inbox),
}));

export const communitiesRelations = relations(communities, ({ many }) => ({
  members: many(communityMembers),
  objects: many(objects),
  joinRequests: many(communityJoinRequests),
  invites: many(communityInvites),
}));

export const communityMembersRelations = relations(communityMembers, ({ one }) => ({
  community: one(communities, {
    fields: [communityMembers.communityApId],
    references: [communities.apId],
  }),
  actor: one(actors, {
    fields: [communityMembers.actorApId],
    references: [actors.apId],
  }),
}));

export const communityJoinRequestsRelations = relations(communityJoinRequests, ({ one }) => ({
  community: one(communities, {
    fields: [communityJoinRequests.communityApId],
    references: [communities.apId],
  }),
  actor: one(actors, {
    fields: [communityJoinRequests.actorApId],
    references: [actors.apId],
  }),
}));

export const communityInvitesRelations = relations(communityInvites, ({ one }) => ({
  community: one(communities, {
    fields: [communityInvites.communityApId],
    references: [communities.apId],
  }),
  invitedBy: one(actors, {
    fields: [communityInvites.invitedByApId],
    references: [actors.apId],
  }),
}));

export const objectRecipientsRelations = relations(objectRecipients, ({ one }) => ({
  object: one(objects, {
    fields: [objectRecipients.objectApId],
    references: [objects.apId],
  }),
  recipient: one(actors, {
    fields: [objectRecipients.recipientApId],
    references: [actors.apId],
  }),
}));

export const inboxRelations = relations(inbox, ({ one }) => ({
  actor: one(actors, {
    fields: [inbox.actorApId],
    references: [actors.apId],
  }),
  activity: one(activities, {
    fields: [inbox.activityApId],
    references: [activities.apId],
  }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  member: one(actors, {
    fields: [sessions.memberId],
    references: [actors.apId],
  }),
}));

export const storyViewsRelations = relations(storyViews, ({ one }) => ({
  actor: one(actors, {
    fields: [storyViews.actorApId],
    references: [actors.apId],
  }),
  story: one(objects, {
    fields: [storyViews.storyApId],
    references: [objects.apId],
  }),
}));

export const storyVotesRelations = relations(storyVotes, ({ one }) => ({
  actor: one(actors, {
    fields: [storyVotes.actorApId],
    references: [actors.apId],
  }),
  story: one(objects, {
    fields: [storyVotes.storyApId],
    references: [objects.apId],
  }),
}));

export const storySharesRelations = relations(storyShares, ({ one }) => ({
  actor: one(actors, {
    fields: [storyShares.actorApId],
    references: [actors.apId],
  }),
  story: one(objects, {
    fields: [storyShares.storyApId],
    references: [objects.apId],
  }),
}));
