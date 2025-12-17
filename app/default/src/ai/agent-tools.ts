/**
 * Agent Tools for App Layer
 *
 * App layer wrapper for AI Agent Tools.
 * Re-exports types and provides App-specific configuration.
 *
 * The actual implementation lives in @takos/platform/server since it requires
 * Core Services access. This module provides:
 * - Type re-exports for App layer usage
 * - App-specific tool configuration
 * - Factory function with App layer defaults
 */

// Re-export types from platform
export type {
  ToolContext,
  DescribeNodeCapabilitiesInput,
  DescribeNodeCapabilitiesOutput,
  InspectServiceInput,
  InspectServiceOutput,
  UpdateTakosConfigInput,
  UpdateTakosConfigOutput,
  ApplyCodePatchInput,
  ApplyCodePatchOutput,
  RunAIActionInput,
  RunAIActionOutput,
  GetTimelineInput,
  GetTimelineOutput,
  GetPostInput,
  GetPostOutput,
  GetUserInput,
  GetUserOutput,
  SearchPostsInput,
  SearchPostsOutput,
  SearchUsersInput,
  SearchUsersOutput,
  GetNotificationsInput,
  GetNotificationsOutput,
  GetDmThreadsInput,
  GetDmThreadsOutput,
  GetDmMessagesInput,
  GetDmMessagesOutput,
  GetCommunitiesInput,
  GetCommunitiesOutput,
  GetCommunityPostsInput,
  GetCommunityPostsOutput,
  ListMediaInput,
  ListMediaOutput,
  GetMediaInput,
  GetMediaOutput,
  DeleteMediaInput,
  DeleteMediaOutput,
  UploadFileInput,
  UploadFileOutput,
  UpdateMediaInput,
  UpdateMediaOutput,
  MoveMediaInput,
  MoveMediaOutput,
  ListFoldersInput,
  ListFoldersOutput,
  CreateFolderInput,
  CreateFolderOutput,
  GetStorageUsageInput,
  GetStorageUsageOutput,
  GenerateImageUrlInput,
  GenerateImageUrlOutput,
  GetFollowersInput,
  GetFollowersOutput,
  GetFollowingInput,
  GetFollowingOutput,
  GetStoriesInput,
  GetStoriesOutput,
  CreatePostToolInput,
  CreatePostToolOutput,
  CreatePollToolInput,
  CreatePollToolOutput,
  EditPostToolInput,
  EditPostToolOutput,
  DeletePostToolInput,
  DeletePostToolOutput,
  CreateStoryToolInput,
  CreateStoryToolOutput,
  DeleteStoryToolInput,
  DeleteStoryToolOutput,
  FollowInput,
  FollowOutput,
  BlockMuteInput,
  BlockMuteOutput,
  ReactToolInput,
  ReactToolOutput,
  UnreactToolInput,
  UnreactToolOutput,
  RepostToolInput,
  RepostToolOutput,
  UnrepostToolInput,
  UnrepostToolOutput,
  BookmarkToolInput,
  BookmarkToolOutput,
  GetBookmarksInput,
  GetBookmarksOutput,
  CreateDmThreadInput,
  CreateDmThreadOutput,
  SendDmInput,
  SendDmOutput,
  JoinCommunityInput,
  JoinCommunityOutput,
  LeaveCommunityInput,
  LeaveCommunityOutput,
  PostToCommunityInput,
  PostToCommunityOutput,
  CreateCommunityInput,
  CreateCommunityOutput,
  UpdateCommunityInput,
  UpdateCommunityOutput,
  CreateChannelInput,
  CreateChannelOutput,
  DeleteChannelInput,
  DeleteChannelOutput,
  UpdateChannelInput,
  UpdateChannelOutput,
  AgentTools,
} from "@takos/platform/server";

// Re-export implementation factory
export {
  createAgentTools,
  type AgentToolsFactoryOptions,
} from "@takos/platform/server";

// Re-export helper functions
export {
  requireAuthenticated,
  checkDataPolicy,
} from "@takos/platform/server";

import type { AgentTools, ToolContext } from "@takos/platform/server";
import {
  createAgentTools,
  type AgentToolsFactoryOptions,
} from "@takos/platform/server";
import type { AppEnv } from "@takos/app-sdk/server";

/**
 * App layer specific options for agent tools
 */
export interface AppAgentToolsOptions {
  /** App environment */
  env: AppEnv;
  /** Base URL for App API calls (default: derived from request) */
  appApiBaseUrl?: string;
  /** Require manual approval for config changes (default: false) */
  requireApproval?: boolean;
  /** Custom audit logger */
  auditLog?: (event: {
    tool: string;
    agentType?: string | null;
    userId?: string | null;
    success: boolean;
    message?: string;
  }) => Promise<void> | void;
}

/**
 * Create agent tools for App layer with default configuration
 *
 * This factory function creates agent tools with App-specific defaults:
 * - Auto-configured App API fetcher using the request context
 * - Default config allowlist for safe AI modifications
 * - Integration with App layer services
 */
export function createAppAgentTools(
  options: AppAgentToolsOptions,
  factoryOptions?: Partial<AgentToolsFactoryOptions>,
): AgentTools {
  const { env, appApiBaseUrl, requireApproval = false, auditLog } = options;

  // Create App API fetcher
  const fetchAppApi = async (path: string, init?: RequestInit): Promise<Response> => {
    // Use provided base URL or construct from env
    const baseUrl = appApiBaseUrl || "";
    const url = `${baseUrl}${path}`;

    // Forward auth context if available
    const headers = new Headers(init?.headers);
    if (env.auth?.sessionId) {
      headers.set("X-Session-Id", env.auth.sessionId);
    }

    return fetch(url, {
      ...init,
      headers,
    });
  };

  // Build factory options
  const fullOptions: AgentToolsFactoryOptions = {
    actionRegistry: (env as any).takosConfig?.ai?.actionRegistry ?? {
      getAction: () => null,
      listActions: () => [],
      register: () => {},
    },
    requireApproval,
    auditLog,
    fetchAppApi,
    // Default config allowlist for safe AI modifications
    configAllowlist: [
      "ai.enabled",
      "ai.default_provider",
      "ai.enabled_actions",
      "ui.theme",
      "ui.accent_color",
    ],
    ...factoryOptions,
  };

  return createAgentTools(fullOptions);
}

/**
 * Tool registry for LangChain/LangGraph integration
 *
 * Returns tool definitions in a format compatible with LangChain tool schemas
 */
export interface LangChainToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, {
      type: string;
      description?: string;
      enum?: string[];
      items?: { type: string };
    }>;
    required?: string[];
  };
}

/**
 * Get tool definitions for LangChain/LangGraph integration
 */
export function getLangChainToolDefinitions(): LangChainToolDefinition[] {
  return [
    {
      name: "describeNodeCapabilities",
      description: "Get information about the current node's capabilities, features, and available AI actions",
      parameters: {
        type: "object",
        properties: {
          level: {
            type: "string",
            enum: ["basic", "full"],
            description: "Detail level: basic or full",
          },
        },
      },
    },
    {
      name: "inspectService",
      description: "Get information about available Core Kernel services and their methods",
      parameters: {
        type: "object",
        properties: {
          serviceName: {
            type: "string",
            enum: ["posts", "users", "communities", "dm", "stories"],
            description: "Service name to inspect (optional, returns all if not specified)",
          },
        },
      },
    },
    {
      name: "getTimeline",
      description: "Get posts from home, local, or federated timeline",
      parameters: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["home", "local", "federated"],
            description: "Timeline type",
          },
          limit: { type: "number", description: "Maximum number of posts to return" },
          cursor: { type: "string", description: "Pagination cursor" },
          only_media: { type: "boolean", description: "Only include posts with media" },
        },
        required: ["type"],
      },
    },
    {
      name: "getPost",
      description: "Get a single post by ID",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Post ID" },
          includeThread: { type: "boolean", description: "Include thread context" },
        },
        required: ["id"],
      },
    },
    {
      name: "getUser",
      description: "Get user information by ID",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "User ID" },
        },
        required: ["id"],
      },
    },
    {
      name: "searchPosts",
      description: "Search for posts matching a query",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          limit: { type: "number", description: "Maximum results" },
          offset: { type: "number", description: "Offset for pagination" },
        },
        required: ["query"],
      },
    },
    {
      name: "searchUsers",
      description: "Search for users matching a query",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          limit: { type: "number", description: "Maximum results" },
          local_only: { type: "boolean", description: "Only search local users" },
        },
        required: ["query"],
      },
    },
    {
      name: "createPost",
      description: "Create a new post",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "Post content" },
          visibility: {
            type: "string",
            enum: ["public", "unlisted", "followers", "direct", "community"],
            description: "Visibility level",
          },
          community_id: { type: "string", description: "Community ID (if posting to community)" },
          reply_to: { type: "string", description: "Post ID to reply to" },
          media_ids: {
            type: "array",
            items: { type: "string" },
            description: "Media attachment IDs",
          },
          sensitive: { type: "boolean", description: "Mark as sensitive content" },
        },
        required: ["content"],
      },
    },
    {
      name: "runAIAction",
      description: "Run a registered AI action",
      parameters: {
        type: "object",
        properties: {
          actionId: { type: "string", description: "AI action ID (e.g., ai.summary, ai.translate)" },
          input: { type: "object", description: "Input parameters for the action" },
        },
        required: ["actionId", "input"],
      },
    },
    {
      name: "getDmThreads",
      description: "Get list of DM threads",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Maximum number of threads" },
          offset: { type: "number", description: "Offset for pagination" },
        },
      },
    },
    {
      name: "sendDm",
      description: "Send a direct message",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "Message content" },
          thread_id: { type: "string", description: "Thread ID (for existing thread)" },
          recipients: {
            type: "array",
            items: { type: "string" },
            description: "Recipient user handles (for new thread)",
          },
        },
        required: ["content"],
      },
    },
    {
      name: "getCommunities",
      description: "Get list of communities",
      parameters: {
        type: "object",
        properties: {
          q: { type: "string", description: "Search query" },
          limit: { type: "number", description: "Maximum results" },
        },
      },
    },
    {
      name: "joinCommunity",
      description: "Join a community",
      parameters: {
        type: "object",
        properties: {
          communityId: { type: "string", description: "Community ID to join" },
        },
        required: ["communityId"],
      },
    },
    {
      name: "follow",
      description: "Follow a user",
      parameters: {
        type: "object",
        properties: {
          targetUserId: { type: "string", description: "User ID to follow" },
        },
        required: ["targetUserId"],
      },
    },
    {
      name: "react",
      description: "Add a reaction to a post",
      parameters: {
        type: "object",
        properties: {
          post_id: { type: "string", description: "Post ID" },
          emoji: { type: "string", description: "Emoji to react with" },
        },
        required: ["post_id", "emoji"],
      },
    },
    {
      name: "bookmark",
      description: "Bookmark a post",
      parameters: {
        type: "object",
        properties: {
          post_id: { type: "string", description: "Post ID to bookmark" },
        },
        required: ["post_id"],
      },
    },
  ];
}

/**
 * Tool name to function mapping helper
 */
export function getToolFunction(tools: AgentTools, toolName: string): ((ctx: ToolContext, input: unknown) => Promise<unknown>) | null {
  const toolMap: Record<string, keyof AgentTools> = {
    describeNodeCapabilities: "describeNodeCapabilities",
    inspectService: "inspectService",
    updateTakosConfig: "updateTakosConfig",
    applyCodePatch: "applyCodePatch",
    runAIAction: "runAIAction",
    getTimeline: "getTimeline",
    getPost: "getPost",
    getUser: "getUser",
    searchPosts: "searchPosts",
    searchUsers: "searchUsers",
    getNotifications: "getNotifications",
    getDmThreads: "getDmThreads",
    getDmMessages: "getDmMessages",
    getCommunities: "getCommunities",
    getCommunityPosts: "getCommunityPosts",
    listMedia: "listMedia",
    getMedia: "getMedia",
    deleteMedia: "deleteMedia",
    uploadFile: "uploadFile",
    uploadMedia: "uploadMedia",
    updateMedia: "updateMedia",
    moveMedia: "moveMedia",
    listFolders: "listFolders",
    createFolder: "createFolder",
    getStorageUsage: "getStorageUsage",
    generateImageUrl: "generateImageUrl",
    getFollowers: "getFollowers",
    getFollowing: "getFollowing",
    getStories: "getStories",
    createPost: "createPost",
    createPoll: "createPoll",
    editPost: "editPost",
    deletePost: "deletePost",
    createStory: "createStory",
    deleteStory: "deleteStory",
    follow: "follow",
    unfollow: "unfollow",
    block: "block",
    unblock: "unblock",
    mute: "mute",
    unmute: "unmute",
    react: "react",
    unreact: "unreact",
    repost: "repost",
    unrepost: "unrepost",
    bookmark: "bookmark",
    unbookmark: "unbookmark",
    getBookmarks: "getBookmarks",
    createDmThread: "createDmThread",
    sendDm: "sendDm",
    joinCommunity: "joinCommunity",
    leaveCommunity: "leaveCommunity",
    postToCommunity: "postToCommunity",
    createCommunity: "createCommunity",
    updateCommunity: "updateCommunity",
    createChannel: "createChannel",
    deleteChannel: "deleteChannel",
    updateChannel: "updateChannel",
  };

  const key = toolMap[toolName];
  if (!key) return null;

  const fn = tools[key];
  return fn as (ctx: ToolContext, input: unknown) => Promise<unknown>;
}
