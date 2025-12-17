export const BUILTIN_AGENT_TOOL_IDS = [
  // 1. Info tools (all agents)
  "tool.describeNodeCapabilities",
  "tool.inspectService",
  "tool.getTimeline",
  "tool.getPost",
  "tool.getUser",
  "tool.searchPosts",
  "tool.searchUsers",
  "tool.getNotifications",
  "tool.getDmThreads",
  "tool.getDmMessages",
  "tool.getCommunities",
  "tool.getCommunityPosts",
  "tool.getStories",
  "tool.getFollowers",
  "tool.getFollowing",
  "tool.getBookmarks",

  // 2. Content creation (user+)
  "tool.createPost",
  "tool.editPost",
  "tool.deletePost",
  "tool.createStory",
  "tool.deleteStory",
  "tool.uploadMedia",
  "tool.createPoll",

  // 3. Storage (user+)
  "tool.listMedia",
  "tool.getMedia",
  "tool.uploadFile",
  "tool.updateMedia",
  "tool.deleteMedia",
  "tool.moveMedia",
  "tool.listFolders",
  "tool.createFolder",
  "tool.getStorageUsage",
  "tool.generateImageUrl",

  // 4. Social (user+)
  "tool.follow",
  "tool.unfollow",
  "tool.block",
  "tool.unblock",
  "tool.mute",
  "tool.unmute",
  "tool.react",
  "tool.unreact",
  "tool.repost",
  "tool.unrepost",
  "tool.bookmark",
  "tool.unbookmark",
  "tool.sendDm",
  "tool.createDmThread",

  // 5. Community operations (power+)
  "tool.createCommunity",
  "tool.updateCommunity",
  "tool.deleteCommunity",
  "tool.joinCommunity",
  "tool.leaveCommunity",
  "tool.createChannel",
  "tool.updateChannel",
  "tool.deleteChannel",
  "tool.postToCommunity",
  "tool.moderatePost",
  "tool.banUser",
  "tool.unbanUser",

  // 6. Config (system+)
  "tool.updateTakosConfig",
  "tool.updateProfile",
  "tool.updatePrivacy",
  "tool.manageBlocklist",
  "tool.manageAllowlist",
  "tool.configureAi",
  "tool.manageWebhooks",

  // 7. Dev (dev+)
  "tool.applyCodePatch",
  "tool.createWorkspace",
  "tool.deployRevision",
  "tool.rollbackRevision",
  "tool.editAppManifest",
  "tool.editUiDefinition",
  "tool.runMigration",

  // 8. Automation (power+/system+/full)
  "tool.schedulePost",
  "tool.createAutomation",
  "tool.deleteAutomation",
  "tool.triggerWorkflow",
  "tool.setReminder",

  // 9. Analytics (power+/system+/full)
  "tool.getAnalytics",
  "tool.getEngagementStats",
  "tool.getFollowerGrowth",
  "tool.exportData",

  // 10. AI execution
  "tool.runAIAction",
  "tool.summarize",
  "tool.translate",
  "tool.suggestTags",
  "tool.generateAltText",
  "tool.moderateContent",
  "tool.detectSpam",
] as const;

export type AgentToolId = (typeof BUILTIN_AGENT_TOOL_IDS)[number];

export type AgentType = "guest" | "user" | "power" | "system" | "dev" | "full";

const toolSet = (...tools: AgentToolId[]) => new Set<AgentToolId>(tools);

const GUEST_TOOLS: ReadonlySet<AgentToolId> = toolSet(
  "tool.describeNodeCapabilities",
  "tool.inspectService",
  "tool.getTimeline",
  "tool.getPost",
  "tool.getUser",
  "tool.searchPosts",
  "tool.searchUsers",
  "tool.getCommunities",
  "tool.getCommunityPosts",
  "tool.getStories",
);

const USER_TOOLS: ReadonlySet<AgentToolId> = new Set([
  ...GUEST_TOOLS,
  "tool.getNotifications",
  "tool.getDmThreads",
  "tool.getDmMessages",
  "tool.getFollowers",
  "tool.getFollowing",
  "tool.getBookmarks",
  "tool.createPost",
  "tool.editPost",
  "tool.deletePost",
  "tool.createStory",
  "tool.deleteStory",
  "tool.uploadMedia",
  "tool.createPoll",
  "tool.listMedia",
  "tool.getMedia",
  "tool.uploadFile",
  "tool.updateMedia",
  "tool.deleteMedia",
  "tool.moveMedia",
  "tool.listFolders",
  "tool.createFolder",
  "tool.getStorageUsage",
  "tool.generateImageUrl",
  "tool.follow",
  "tool.unfollow",
  "tool.block",
  "tool.unblock",
  "tool.mute",
  "tool.unmute",
  "tool.react",
  "tool.unreact",
  "tool.repost",
  "tool.unrepost",
  "tool.bookmark",
  "tool.unbookmark",
  "tool.sendDm",
  "tool.createDmThread",
  "tool.joinCommunity",
  "tool.leaveCommunity",
  "tool.postToCommunity",
  "tool.runAIAction",
]);

const POWER_TOOLS: ReadonlySet<AgentToolId> = new Set([
  ...USER_TOOLS,
  "tool.createCommunity",
  "tool.updateCommunity",
  "tool.deleteCommunity",
  "tool.createChannel",
  "tool.updateChannel",
  "tool.deleteChannel",
  "tool.moderatePost",
  "tool.banUser",
  "tool.unbanUser",
  "tool.schedulePost",
  "tool.createAutomation",
  "tool.deleteAutomation",
  "tool.triggerWorkflow",
  "tool.setReminder",
  "tool.getAnalytics",
  "tool.getEngagementStats",
  "tool.getFollowerGrowth",
  "tool.exportData",
]);

const SYSTEM_TOOLS: ReadonlySet<AgentToolId> = new Set([
  ...POWER_TOOLS,
  "tool.updateTakosConfig",
  "tool.updateProfile",
  "tool.updatePrivacy",
  "tool.manageBlocklist",
  "tool.manageAllowlist",
  "tool.configureAi",
  "tool.manageWebhooks",
]);

const DEV_TOOLS: ReadonlySet<AgentToolId> = new Set([
  ...SYSTEM_TOOLS,
  "tool.applyCodePatch",
  "tool.createWorkspace",
  "tool.deployRevision",
  "tool.rollbackRevision",
  "tool.editAppManifest",
  "tool.editUiDefinition",
  "tool.runMigration",
]);

const FULL_TOOLS: ReadonlySet<AgentToolId> = new Set(BUILTIN_AGENT_TOOL_IDS);

const AGENT_TOOL_ALLOWLIST: Record<AgentType, ReadonlySet<AgentToolId>> = {
  guest: GUEST_TOOLS,
  user: USER_TOOLS,
  power: POWER_TOOLS,
  system: SYSTEM_TOOLS,
  dev: DEV_TOOLS,
  full: FULL_TOOLS,
};

export const CONFIG_MUTATION_TOOLS: ReadonlySet<AgentToolId> = new Set([
  "tool.updateTakosConfig",
]);

export const CODE_MUTATION_TOOLS: ReadonlySet<AgentToolId> = new Set([
  "tool.applyCodePatch",
]);

export function normalizeAgentType(value: unknown): AgentType | null {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "admin") return "system";
  if (
    normalized === "guest" ||
    normalized === "user" ||
    normalized === "power" ||
    normalized === "system" ||
    normalized === "dev" ||
    normalized === "full"
  ) {
    return normalized;
  }
  return null;
}

export function isToolAllowedForAgent(agentType: AgentType, toolId: AgentToolId): boolean {
  return AGENT_TOOL_ALLOWLIST[agentType].has(toolId);
}

export function assertToolAllowedForAgent(agentType: AgentType, toolId: AgentToolId): void {
  if (!isToolAllowedForAgent(agentType, toolId)) {
    throw new Error(`Agent type "${agentType}" is not allowed to call ${toolId}`);
  }
}
