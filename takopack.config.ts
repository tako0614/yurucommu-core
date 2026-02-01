import { defineConfig } from 'takopack';

export default defineConfig({
  name: 'yurucommu',
  version: '3.0.0',
  description: 'ActivityPub-based community platform',
  icon: 'users',

  // Cloudflare resources to be auto-provisioned
  resources: {
    d1: [{ binding: 'DB', migrations: './migrations' }],
    r2: [{ binding: 'MEDIA' }],
    kv: [{ binding: 'KV' }],
  },

  // OAuth client configuration
  oauth: {
    clientName: 'Yurucommu',
    redirectUris: ['https://${HOSTNAME}/api/auth/callback/takos'],
    scopes: ['openid', 'profile', 'email'],
    autoEnv: true,
  },

  // Environment variables
  env: {
    required: ['SESSION_SECRET', 'ENCRYPTION_KEY'],
    defaults: {
      PUBLIC_SITE_NAME: 'My Yurucommu',
    },
  },

  // Worker bundle configuration
  workers: [
    {
      name: 'yurucommu',
      entry: './dist-wrangler/worker.js',
      bindings: {
        d1: ['DB'],
        r2: ['MEDIA'],
        kv: ['KV'],
      },
    },
  ],

  // Custom tools for AI agent integration
  tools: [
    // Search tools
    {
      name: 'yurucommu_search_users',
      description: 'Search for users by username or display name',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          limit: { type: 'number', description: 'Maximum number of results' },
        },
        required: ['query'],
      },
      worker: 'yurucommu',
    },
    {
      name: 'yurucommu_search_posts',
      description: 'Search posts by content',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          limit: { type: 'number', description: 'Maximum number of results' },
        },
        required: ['query'],
      },
      worker: 'yurucommu',
    },
    {
      name: 'yurucommu_get_trending',
      description: 'Get trending hashtags and topics',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Maximum number of results' },
        },
      },
      worker: 'yurucommu',
    },
    {
      name: 'yurucommu_get_user_profile',
      description: 'Get user profile by username',
      input_schema: {
        type: 'object',
        properties: {
          username: { type: 'string', description: 'Username' },
        },
        required: ['username'],
      },
      worker: 'yurucommu',
    },

    // Post tools
    {
      name: 'yurucommu_create_post',
      description: 'Create a new post',
      input_schema: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'Post content' },
          visibility: {
            type: 'string',
            enum: ['public', 'unlisted', 'followers', 'direct'],
            description: 'Post visibility',
          },
          in_reply_to: { type: 'string', description: 'ID of post to reply to' },
        },
        required: ['content'],
      },
      worker: 'yurucommu',
    },
    {
      name: 'yurucommu_delete_post',
      description: 'Delete a post',
      input_schema: {
        type: 'object',
        properties: {
          post_id: { type: 'string', description: 'Post ID to delete' },
        },
        required: ['post_id'],
      },
      worker: 'yurucommu',
    },
    {
      name: 'yurucommu_like_post',
      description: 'Like or unlike a post',
      input_schema: {
        type: 'object',
        properties: {
          post_id: { type: 'string', description: 'Post ID' },
          like: { type: 'boolean', description: 'true to like, false to unlike' },
        },
        required: ['post_id', 'like'],
      },
      worker: 'yurucommu',
    },
    {
      name: 'yurucommu_bookmark_post',
      description: 'Bookmark or unbookmark a post',
      input_schema: {
        type: 'object',
        properties: {
          post_id: { type: 'string', description: 'Post ID' },
          bookmark: { type: 'boolean', description: 'true to bookmark, false to unbookmark' },
        },
        required: ['post_id', 'bookmark'],
      },
      worker: 'yurucommu',
    },

    // Follow tools
    {
      name: 'yurucommu_follow_user',
      description: 'Follow a user',
      input_schema: {
        type: 'object',
        properties: {
          username: { type: 'string', description: 'Username to follow' },
        },
        required: ['username'],
      },
      worker: 'yurucommu',
    },
    {
      name: 'yurucommu_unfollow_user',
      description: 'Unfollow a user',
      input_schema: {
        type: 'object',
        properties: {
          username: { type: 'string', description: 'Username to unfollow' },
        },
        required: ['username'],
      },
      worker: 'yurucommu',
    },
    {
      name: 'yurucommu_get_followers',
      description: 'Get list of followers',
      input_schema: {
        type: 'object',
        properties: {
          username: { type: 'string', description: 'Username' },
          limit: { type: 'number', description: 'Maximum number of results' },
        },
        required: ['username'],
      },
      worker: 'yurucommu',
    },
    {
      name: 'yurucommu_get_following',
      description: 'Get list of users being followed',
      input_schema: {
        type: 'object',
        properties: {
          username: { type: 'string', description: 'Username' },
          limit: { type: 'number', description: 'Maximum number of results' },
        },
        required: ['username'],
      },
      worker: 'yurucommu',
    },

    // DM tools
    {
      name: 'yurucommu_send_dm',
      description: 'Send a direct message',
      input_schema: {
        type: 'object',
        properties: {
          recipient: { type: 'string', description: 'Recipient username' },
          content: { type: 'string', description: 'Message content' },
        },
        required: ['recipient', 'content'],
      },
      worker: 'yurucommu',
    },
    {
      name: 'yurucommu_get_dm_threads',
      description: 'Get list of DM conversation threads',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Maximum number of threads' },
        },
      },
      worker: 'yurucommu',
    },
    {
      name: 'yurucommu_get_dm_messages',
      description: 'Get messages in a DM thread',
      input_schema: {
        type: 'object',
        properties: {
          thread_id: { type: 'string', description: 'Thread ID' },
          limit: { type: 'number', description: 'Maximum number of messages' },
        },
        required: ['thread_id'],
      },
      worker: 'yurucommu',
    },

    // Timeline tools
    {
      name: 'yurucommu_get_timeline',
      description: 'Get home timeline',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Maximum number of posts' },
          before: { type: 'string', description: 'Cursor for pagination' },
        },
      },
      worker: 'yurucommu',
    },
    {
      name: 'yurucommu_get_notifications',
      description: 'Get notifications',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Maximum number of notifications' },
          unread_only: { type: 'boolean', description: 'Only return unread notifications' },
        },
      },
      worker: 'yurucommu',
    },
  ],
});
