---
title: "ActivityPub Spec"
outline: deep
---

# ActivityPub Spec

This chapter codifies the ActivityPub-facing contracts that Takos exposes per instance. The worker implementation publishes these details to **https://docs.takos.jp** so remote servers can safely federate with Takos deployments.

The sections below only spell out Takos-specific routing, auth, and payload differences. For baseline semantics, signature requirements, and ActivityStreams object shapes, reference the [W3C ActivityPub Recommendation](https://www.w3.org/TR/activitypub/) and the downstream server behavior you already implement.

## Scope & guiding rules

- Every instance reuses the same `INSTANCE_DOMAIN` that powers REST routing. All ActivityPub IDs therefore live under a fully qualified domain such as `https://alice.example.com`.
- Public discovery (`/.well-known/webfinger`, actor JSON) never requires authentication. Private collections and objects inherit the same bearer-token model as the REST APIs.
- Inbox writes must include HTTP Signatures. The Worker validates both the signature and the actor’s key ownership before persisting activities.

## Domains, access, and authentication

- `INSTANCE_DOMAIN` already includes the handle + domain (`alice.example.com`). Requests against the apex such as `https://example.com/ap/...` are rejected early.
- Discovery surfaces (`/.well-known/webfinger`, `/ap/users/:handle`, `/ap/groups/:slug`) remain public, while private collections (`/ap/users/:handle/outbox`, `/ap/stories/:id`, DM/channels) reuse bearer tokens that start with `acc_` and are validated by `platform/src/auth/account-auth.ts`.
- `/ap/inbox` always requires a valid HTTP Signature whose public key belongs to the posting actor.

## Discovery & routing

### WebFinger

`/.well-known/webfinger` follows the standard request contract and resolves `acct:{handle}@{domain}` into aliases + the canonical actor `self` link. Parsing logic lives in `platform/src/activitypub/activitypub-routes.ts`.

### Actor endpoints

- Person actors live at `GET /ap/users/:handle`.
- Community actors live at `GET /ap/groups/:slug`.

Only the Takos-specific traits differ from the baseline ActivityStreams actor documents:

- Both endpoints export `inbox`, `outbox`, and federated collection URLs that match the instance domain.
- `ap_keypairs` drives the `publicKey` block; when no key exists the actor omits it entirely instead of returning placeholders.
- All actors default to `discoverable = false` and `manuallyApprovesFollowers = true` until admins explicitly enable discovery.

### Group-specific behavior

Community actors add federation glue that differs from user accounts:

- **Owner-backed keys** — `generateGroupActor` reuses the community owner's key pair; the group `publicKey.owner` correctly points at the group URI and the PEM payload is issued by `ensureUserKeyPair` for the owner. Rotating the owner's key therefore refreshes the community actor as well. This approach allows the owner to sign activities on behalf of the group.
- **Followers as members** — Community members are represented as followers who have been accepted. The standard `followers` collection is used instead of a custom `members` field for ActivityPub compatibility.
- **Auto-accept follows** — Incoming `Follow` requests to the group inbox trigger an automatic `Accept` activity recorded in the owner’s outbox and enqueued for delivery (`group:{slug}` becomes the local follower record).
- **Inbox gating** — Any activity other than `Follow` is rejected unless the remote actor already appears in the group’s follower table with `status = "accepted"`, effectively turning `Follow` into the membership handshake.
- **Redirect for non-ActivityPub requests** — Plain HTTP requests to `/ap/groups/:slug` are redirected to `/communities/:slug`, letting humans view the community page while bots fetch JSON.

## Collections

Takos exposes ActivityStreams collections that mirror the database tables listed below.

| Endpoint | Backing store | Notes |
| --- | --- | --- |
| `GET /ap/users/:handle/outbox` | `ap_outbox_activities` | Ordered collection with pagination via `page` query; omitting `page` returns metadata (`first`). |
| `GET /ap/users/:handle/followers` | `ap_followers` | Returned as `OrderedCollectionPage`. |
| `GET /ap/users/:handle/following` | `ap_following` | Same pagination contract as followers. |
| `GET /ap/groups/:slug/outbox` | Community posts from D1 | Posts are wrapped in `Create` with `generateNoteObject`. |
| `GET /ap/stories/:id` | Story records scoped to the current instance | Uses `toStoryObject`; requires bearer tokens for private visibility. |
| `GET /ap/dm/:threadId` | `chat_dm_messages` | Returns the newest 50 items as `OrderedCollection`; bearer token required. |
| `GET /ap/channels/:communityId/:channelId/messages` | `chat_channel_messages` | Channel timeline, bearer token required. |

## Story federation

### Story surface

- `GET /ap/stories/:id` validates instance scoping, ownership, and visibility before returning the serialized story.
- REST mutations call `publishStoryCreate` / `publishStoryDelete` so ActivityPub fan-out always mirrors the latest state.

### Story object schema

```json
{
  "@context": [
    "https://www.w3.org/ns/activitystreams",
    "https://docs.takos.jp/ns/activitypub/v1.jsonld"
  ],
  "id": "https://example.com/ap/stories/01HXYZ...",
  "type": "Story",
  "actor": "https://example.com/ap/users/alice",
  "published": "2024-06-24T08:32:41.000Z",
  "expiresAt": "2024-06-25T08:32:41.000Z",
  "visibility": "friends",
  "slides": [
    {
      "type": "StoryImageSlide",
      "media": {
        "type": "Image",
        "mediaType": "image/jpeg",
        "url": "https://cdn.example.com/01HXYZ-cover.jpg",
        "width": 1080,
        "height": 1920
      },
      "alt": "Sunrise over Tokyo",
      "durationMs": 5000,
      "order": 0
    },
    {
      "type": "StoryTextSlide",
      "content": "New release notes just shipped.",
      "format": "plain",
      "align": "center",
      "backgroundColor": "#101820",
      "durationMs": 5000,
      "order": 1
    },
    {
      "type": "StoryExtensionSlide",
      "extensionType": "takos.canvas",
      "payload": {
        "canvas": {
          "...": "See CanvasData schema for the full canvas structure"
        }
      },
      "durationMs": 5000,
      "order": 2
    }
  ]
}
```

Key rules:

- Extend ActivityStreams with the `Story` namespace hosted at `https://docs.takos.jp/ns/activitypub/v1.jsonld`; the same context also describes `DirectMessage` and `ChannelMessage` payloads for messaging.
- `slides` fan out a union of Story-specific slide types:
  - `StoryImageSlide` – wraps ActivityStreams `Image` objects, including dimensions and alt text.
  - `StoryVideoSlide` – wraps ActivityStreams `Video` objects plus optional `hasAudio` and poster metadata.
  - `StoryTextSlide` – plain/markdown text slides with lightweight formatting hints (alignment, font, colors).
  - `StoryExtensionSlide` – namespaced extensions (e.g. `takos.canvas`) with arbitrary JSON payloads.
- Every slide honors `durationMs` (clamped between 1500–60000ms) and derives `order` from the array position when omitted. Extension type names should be reverse-domain strings (`takos.canvas`, `example.poll`, etc.).
- `visibility` defaults to `friends`. Setting `public` pushes the `Create` activity to the public collection.

### Fan-out envelope

`publishStoryCreate` wraps the story object in a standard `Create` activity:

```json
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "type": "Create",
  "id": "https://example.com/ap/activities/01HXYZ...",
  "actor": "https://example.com/ap/users/alice",
  "to": [
    "https://example.com/ap/users/alice/followers"
  ],
  "object": {
    "...": "Story payload shown above"
  }
}
```

Slides follow a consistent schema:

- `type`: Always `StorySlide`.
- `mediaType`: `image` or `video` (derived from the item).
- `url`: Media URL, or `null` for DOM slides.
- `dom`: Serialized canvas payload for `type = "dom"`.
- `durationMs`: Defaults to `5000`; video uploads bump to `8000`.
- `order`: Slide ordering, defaulting to creation order.

## Messaging surfaces

Takos federates direct and channel conversations via helpers in `platform/src/activitypub/chat.ts`.
Both message types reuse the same custom context (`https://docs.takos.jp/ns/activitypub/v1.jsonld`) so `DirectMessage` and `ChannelMessage` objects remain machine-readable.

### Direct messages

- `sendDirectMessage` assembles the `Create` activity, delivers it, and persists it locally.
- `GET /ap/dm/:threadId` returns the newest 50 entries as an `OrderedCollection` and always requires a bearer token.
- Incoming DM activities are processed via `handleIncomingDm`, which validates membership and stores the payload before surfacing it via REST.

### Channel messages

- Channel IDs take the form `https://{domain}/ap/channels/{communityId}/{channelId}`.
- `sendChannelMessage` emits a `Create` with `object.type = "ChannelMessage"` and saves the record.
- `GET /ap/channels/:communityId/:channelId/messages` exposes the ordered log for authenticated members.
- `handleIncomingChannelMessage` stores remote messages before surfacing them through the REST API.

## Operational notes

- Use `activityPubResponse` to enforce `Content-Type: application/activity+json`.
- Release D1 resources via `releaseStore` after every datastore call to avoid leaking connections (`activitypub-routes.ts` shows the pattern).
- Federation helpers in `platform/src/activitypub/story-publisher.ts` enqueue outbound deliveries through `enqueueActivity`, inheriting the shared retry policy.
