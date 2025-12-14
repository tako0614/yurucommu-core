---
title: "App Layer Spec"
outline: deep
---

# App Layer Spec

This chapter defines the App Layer specification for takos. The App Layer provides a declarative, JSON-based system for defining routes, views, ActivityPub handlers, data collections, and storage configurations.

## Overview

The App Layer consists of two primary components:

1. **App Manifest** — JSON definitions that describe the application structure
2. **App Script** — TypeScript/JavaScript handlers that implement business logic

### Design Principles

#### All UI is defined in App Manifest

- All standard UI screens are defined as UiNode trees in `app/views/*.json`
- Web clients (SolidJS, etc.) act as **UI runtimes** that render the manifest
- Clients read the `views` and UiNode structure, then render accordingly

Benefits:
- Alternative clients can implement identical UI based on the published spec
- UI customization requires only manifest changes, not client code changes

#### One Node = One App

- Each takos node runs exactly one App
- "App" means "the node's program"
- Distribution unit is `takos-distribution` (the complete package)

## Manifest Structure

### Root Manifest (`takos-app.json`)

```json
{
  "schema_version": "1.0",
  "version": "0.1.0",
  "layout": {
    "base_dir": "app",
    "routes_dir": "routes",
    "views_dir": "views",
    "ap_dir": "ap",
    "data_dir": "data",
    "storage_dir": "storage"
  }
}
```

| Field | Description |
|-------|-------------|
| `schema_version` | Manifest format version |
| `version` | App version (semver) |
| `layout.base_dir` | Base directory for app definitions |
| `layout.routes_dir` | Subdirectory for route definitions |
| `layout.views_dir` | Subdirectory for view definitions |
| `layout.ap_dir` | Subdirectory for ActivityPub handlers |
| `layout.data_dir` | Subdirectory for data collection definitions |
| `layout.storage_dir` | Subdirectory for storage bucket definitions |

### File Structure

```
takos/
├── takos-app.json          # Root manifest
├── app-main.ts             # App Script (handlers)
└── app/
    ├── routes/
    │   ├── posts.json
    │   ├── communities.json
    │   ├── stories.json
    │   ├── chat.json
    │   └── ...
    ├── views/
    │   ├── screens-core.json
    │   ├── insert-core.json
    │   └── ...
    ├── ap/
    │   └── core.json
    ├── data/
    │   ├── notes.json
    │   └── collections.json
    └── storage/
        ├── buckets.json
        └── attachments.json
```

## Route Definitions

Routes define HTTP endpoints and map them to handlers in the App Script.

### Schema

```json
{
  "routes": [
    {
      "id": "posts_create",
      "method": "POST",
      "path": "/posts",
      "handler": "createPost",
      "auth": true,
      "description": "Create a new post."
    }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique route identifier |
| `method` | string | Yes | HTTP method (`GET`, `POST`, `PATCH`, `DELETE`) |
| `path` | string | Yes | URL path pattern (supports `:param` placeholders) |
| `handler` | string | Yes | Handler function name in App Script |
| `auth` | boolean | No | Whether authentication is required (default: `false`) |
| `description` | string | No | Human-readable description |

### Path Parameters

Routes support dynamic path segments using `:param` syntax:

```json
{
  "id": "posts_get",
  "method": "GET",
  "path": "/posts/:id",
  "handler": "getPost"
}
```

### Core Routes

<details>
<summary>Posts Routes</summary>

| ID | Method | Path | Handler | Description |
|----|--------|------|---------|-------------|
| `posts_create` | POST | `/posts` | `createPost` | Create a new post |
| `posts_list` | GET | `/posts` | `listPosts` | List timeline posts |
| `posts_search` | GET | `/posts/search` | `searchPosts` | Full-text search |
| `posts_get` | GET | `/posts/:id` | `getPost` | Fetch a single post |
| `posts_update` | PATCH | `/posts/:id` | `updatePost` | Edit an existing post |
| `posts_delete` | DELETE | `/posts/:id` | `deletePost` | Delete a post |
| `posts_history` | GET | `/posts/:id/history` | `getPostHistory` | Return edit history |
| `posts_poll` | GET | `/posts/:id/poll` | `getPostPoll` | Fetch poll metadata |
| `posts_vote` | POST | `/posts/:id/vote` | `voteOnPost` | Vote on a poll |
| `posts_repost` | POST | `/posts/:id/reposts` | `repost` | Repost/boost a post |
| `posts_unrepost` | DELETE | `/posts/:id/reposts` | `undoRepost` | Undo a repost |
| `posts_reactions` | GET | `/posts/:id/reactions` | `listPostReactions` | List reactions |
| `posts_add_reaction` | POST | `/posts/:id/reactions` | `addPostReaction` | Add a reaction |
| `posts_remove_reaction` | DELETE | `/posts/:id/reactions/:reactionId` | `removePostReaction` | Remove a reaction |
| `posts_comments` | GET | `/posts/:id/comments` | `listComments` | List comments |
| `posts_add_comment` | POST | `/posts/:id/comments` | `addComment` | Add a comment |
| `posts_delete_comment` | DELETE | `/posts/:id/comments/:commentId` | `deleteComment` | Delete a comment |
| `posts_bookmark` | POST | `/posts/:id/bookmark` | `addBookmark` | Bookmark a post |
| `posts_unbookmark` | DELETE | `/posts/:id/bookmark` | `removeBookmark` | Remove bookmark |
| `posts_bookmarks` | GET | `/me/bookmarks` | `listBookmarks` | List bookmarked posts |

</details>

<details>
<summary>Communities Routes</summary>

| ID | Method | Path | Handler | Description |
|----|--------|------|---------|-------------|
| `communities_list` | GET | `/communities` | `listCommunities` | List/search communities |
| `communities_create` | POST | `/communities` | `createCommunity` | Create a community |
| `communities_get` | GET | `/communities/:id` | `getCommunity` | Fetch community details |
| `communities_update` | PATCH | `/communities/:id` | `updateCommunity` | Update a community |
| `communities_channels_list` | GET | `/communities/:id/channels` | `listChannels` | List channels |
| `communities_channels_create` | POST | `/communities/:id/channels` | `createChannel` | Create a channel |
| `communities_channels_update` | PATCH | `/communities/:id/channels/:channelId` | `updateChannel` | Update a channel |
| `communities_channels_delete` | DELETE | `/communities/:id/channels/:channelId` | `deleteChannel` | Delete a channel |
| `communities_leave` | POST | `/communities/:id/leave` | `leaveCommunity` | Leave a community |
| `communities_direct_invite` | POST | `/communities/:id/direct-invites` | `sendDirectInvite` | Send ActivityPub invite |
| `communities_members` | GET | `/communities/:id/members` | `listCommunityMembers` | List members |
| `communities_accept_invitation` | POST | `/communities/:id/invitations/accept` | `acceptCommunityInvite` | Accept invite |
| `communities_decline_invitation` | POST | `/communities/:id/invitations/decline` | `declineCommunityInvite` | Decline invite |

</details>

<details>
<summary>Chat/DM Routes</summary>

| ID | Method | Path | Handler | Description |
|----|--------|------|---------|-------------|
| `dm_threads` | GET | `/dm/threads` | `listDmThreads` | List DM threads |
| `dm_thread_messages` | GET | `/dm/threads/:threadId/messages` | `getDmThreadMessages` | Fetch thread messages |
| `dm_thread_with_handle` | GET | `/dm/with/:handle` | `getOrCreateDmThread` | Get/create thread with user |
| `dm_send` | POST | `/dm/send` | `sendDm` | Send a direct message |
| `channel_messages_list` | GET | `/communities/:id/channels/:channelId/messages` | `listChannelMessages` | List channel messages |
| `channel_messages_send` | POST | `/communities/:id/channels/:channelId/messages` | `sendChannelMessage` | Send channel message |

</details>

## View Definitions

Views define the UI structure using a declarative UiNode tree.

### Screen Definition

```json
{
  "screens": [
    {
      "id": "screen.home",
      "route": "/",
      "title": "Home",
      "layout": {
        "type": "Column",
        "props": { "id": "root", "gap": 16 },
        "children": [
          {
            "type": "StoriesBar",
            "props": { "id": "stories" }
          },
          {
            "type": "PostFeed",
            "props": {
              "id": "timeline",
              "source": "home",
              "emptyText": "No posts yet"
            }
          }
        ]
      }
    }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique screen identifier (must start with `screen.`) |
| `route` | string | Yes | URL route for this screen |
| `title` | string | Yes | Page title |
| `layout` | UiNode | Yes | Root UI node tree |

### UiNode Structure

```typescript
interface UiNode {
  type: string;           // Component type
  props: Record<string, unknown>;  // Component properties
  children?: UiNode[];    // Child nodes (for containers)
}
```

### Built-in Component Types

#### Layout Components

| Type | Description | Props |
|------|-------------|-------|
| `Column` | Vertical stack | `id`, `gap` |
| `Row` | Horizontal stack | `id`, `gap` |
| `Card` | Card container | `title` |

#### Content Components

| Type | Description | Props |
|------|-------------|-------|
| `PageHeader` | Page header with title | `id`, `title`, `backHref` |
| `Text` | Text content | `text` |
| `Button` | Action button | `action`, `label`, `emphasis` |
| `Placeholder` | Placeholder content | `text` |

#### Domain Components

| Type | Description | Props |
|------|-------------|-------|
| `PostFeed` | Timeline/feed | `id`, `source`, `emptyText` |
| `StoriesBar` | Story carousel | `id` |
| `ThreadList` | DM thread list | `id`, `emptyText` |
| `CommunityList` | Community list | `id`, `showJoined`, `emptyText` |

### Insert Definitions

Inserts allow injecting UI nodes into existing screens at specific positions.

```json
{
  "insert": [
    {
      "screen": "screen.home",
      "position": "header",
      "order": 10,
      "node": {
        "type": "Button",
        "props": {
          "action": "action.open_composer",
          "label": "Compose",
          "emphasis": "primary"
        }
      }
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `screen` | string | Target screen ID |
| `position` | string | Insertion position (`header`, `right-sidebar`, etc.) |
| `order` | number | Sort order within position |
| `node` | UiNode | UI node to insert |

### Core Screens

| ID | Route | Description |
|----|-------|-------------|
| `screen.home` | `/` | Home timeline with stories bar |
| `screen.community` | `/communities/:id` | Community page |
| `screen.dm_list` | `/dm` | Direct message list |
| `screen.communities` | `/communities` | Communities list |
| `screen.profile` | `/profile/:id` | User profile |
| `screen.settings` | `/settings` | Settings page |

## ActivityPub Handlers

ActivityPub handlers map incoming ActivityPub objects to internal processing.

### Schema

```json
{
  "handlers": [
    {
      "id": "ap_note_to_post",
      "match": { "type": ["Note", "Article"] },
      "handler": "mapActivityNote",
      "description": "Maps Note/Article objects into takos posts.",
      "spec_url": "https://docs.takos.jp/activitypub"
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique handler identifier |
| `match.type` | string[] | ActivityPub object types to match |
| `handler` | string | Handler function name |
| `description` | string | Human-readable description |
| `spec_url` | string | Link to relevant specification |

### Core Handlers

| ID | Match Types | Handler | Description |
|----|-------------|---------|-------------|
| `ap_note_to_post` | `Note`, `Article` | `mapActivityNote` | Map to posts |
| `ap_question_to_poll` | `Question` | `mapActivityQuestion` | Map to polls |
| `ap_announce_to_repost` | `Announce` | `mapActivityAnnounce` | Map to reposts |

## Data Collections

Data collections define custom database tables for the App.

### Schema

```json
{
  "collections": {
    "app:notes": {
      "engine": "sqlite",
      "comment": "User-created notes",
      "schema": {
        "columns": [
          { "name": "id", "type": "TEXT", "primary": true },
          { "name": "user_id", "type": "TEXT", "nullable": false },
          { "name": "title", "type": "TEXT", "nullable": false },
          { "name": "content", "type": "TEXT", "nullable": false },
          { "name": "tags", "type": "TEXT", "comment": "JSON array" },
          { "name": "created_at", "type": "TEXT", "nullable": false },
          { "name": "updated_at", "type": "TEXT" }
        ]
      },
      "indexes": [
        {
          "name": "idx_notes_user_created",
          "columns": ["user_id", "created_at DESC"]
        }
      ]
    }
  }
}
```

### Collection Properties

| Field | Type | Description |
|-------|------|-------------|
| `engine` | string | Database engine (`sqlite` for D1) |
| `comment` | string | Human-readable description |
| `schema.columns` | Column[] | Column definitions |
| `indexes` | Index[] | Index definitions |

### Column Properties

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Column name |
| `type` | string | SQL type (`TEXT`, `INTEGER`, `REAL`, `BLOB`) |
| `primary` | boolean | Is primary key |
| `nullable` | boolean | Allows NULL values |
| `comment` | string | Description |

### Naming Convention

Collection names must be prefixed:
- `app:` — Custom app collections
- `core:` — Reserved for core kernel (read-only)

## Storage Buckets

Storage buckets define R2 bucket configurations for file storage.

### Schema

```json
{
  "buckets": {
    "app:attachments": {
      "base_path": "app/attachments/{userId}/",
      "allowed_mime": ["image/*", "video/*"],
      "max_size_mb": 50
    },
    "app:avatars": {
      "base_path": "app/avatars/{userId}/",
      "allowed_mime": ["image/*"],
      "max_size_mb": 5
    }
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `base_path` | string | Path template (supports `{userId}`) |
| `allowed_mime` | string[] | Allowed MIME types (supports wildcards) |
| `max_size_mb` | number | Maximum file size in MB |

## App Script

The App Script (`app-main.ts`) contains handler implementations referenced by routes.

### Handler Signature

```typescript
import type { AppHandler, TakosContext } from "@takos/platform/app";

export const createPost: AppHandler = async (ctx, input) => {
  // Handler implementation
  return ctx.json({ success: true });
};
```

### TakosContext

| Property | Type | Description |
|----------|------|-------------|
| `auth` | AuthContext | Current user authentication |
| `services` | CoreServices | Core Kernel service APIs |
| `db(name)` | Database | Access to data collections |
| `storage(name)` | Storage | Access to storage buckets |
| `ai` | AIProvider | AI capabilities |
| `log(level, message, data)` | void | Structured logging |
| `json(data, options)` | Response | Return JSON response |
| `error(message, status)` | Response | Return error response |
| `redirect(url, status)` | Response | Return redirect response |

### Core Services

Access via `ctx.services`:

| Service | Description |
|---------|-------------|
| `posts` | Post CRUD, timeline, reactions, comments |
| `users` | User profiles, follows, blocks, mutes |
| `communities` | Community management, channels |
| `stories` | Story creation and management |
| `dm` | Direct message threads |
| `media` | Media uploads and storage |

### Example Handler

```typescript
export const listPosts: AppHandler = async (ctx, input) => {
  const auth = ctx.auth ?? { userId: null };
  const services = ctx.services;

  const params = {
    limit: input?.limit ?? 20,
    offset: input?.offset ?? 0,
  };

  ctx.log("info", "listPosts", { params });

  const result = await services.posts.listTimeline(auth, params);
  return ctx.json(result);
};
```

## Workspace & Revision System

### App Workspace

Development environment for editing app definitions.

```typescript
interface AppWorkspace {
  id: string;
  baseRevisionId: string;
  status: "draft" | "validated" | "testing" | "ready" | "applied";
  createdAt: string;
  updatedAt: string;
  author: { type: "human" | "agent"; name?: string };
}
```

### App Revision

Immutable snapshot of app definitions.

```typescript
interface AppRevision {
  id: string;
  createdAt: string;
  author: { type: "human" | "agent"; name?: string };
  message?: string;
  manifestSnapshot: string;
  scriptSnapshotRef: string;
}
```

### Deployment Flow

1. Edit in dev Workspace
2. Run validation
3. Test in dev environment
4. Set Workspace to `"ready"` status
5. **Node owner** executes Apply
6. New AppRevision is created and activated

## Segment Namespacing

### Core Segment (Read-Only)

Reserved prefixes that cannot be modified:
- `core.*` — Core functionality
- `screen.*` — Built-in screens
- `core:*` — Core data collections

### Custom Segment

Freely editable prefixes:
- `app.*` — App-specific definitions
- `distro.*` — Distribution-specific customizations

## Reserved HTTP Paths

These paths are reserved by Core Kernel and cannot be defined in App Manifest:

| Path | Purpose |
|------|---------|
| `/-/core/*` | Core Safe UI |
| `/-/config/*` | takos-config.json export/import |
| `/-/app/*` | AppRevision/Workspace management |
| `/-/health` | Health check |
| `/auth/login`, `/auth/logout` | Authentication |
| `/.well-known/*` | ActivityPub/WebFinger |
| `/nodeinfo/*` | NodeInfo |

## Core Safe UI

Recovery interface independent of App definitions, accessible at `/-/core/*`:

1. Login screen
2. takos-config.json viewer/download
3. takos-config.json upload/import
4. AppRevision list and rollback
5. App definition validation results

This ensures recovery is always possible even if the App is broken.
