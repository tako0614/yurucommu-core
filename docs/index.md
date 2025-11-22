---
layout: home

hero:
  name: "Takos Docs"
  text: "REST API & ActivityPub Reference"
  tagline: "Complete API documentation for the takos platform"
  actions:
    - theme: brand
      text: "REST API Reference"
      link: /api/
    - theme: alt
      text: "ActivityPub Spec"
      link: /activitypub

features:
  - title: REST API
    details: Complete REST API reference for authentication, posts, communities, DMs, and more.
  - title: ActivityPub extensions
    details: Custom actors, collections, and messaging envelopes used by Takos when federating stories, DMs, and channels.
  - title: Deployment guidance
    details: Domain mapping, authentication, and signature requirements shared by Worker deployments.
---

## Purpose

Takos publishes **https://docs.takos.jp** as the public contract for the platform's REST API and ActivityPub extensions. This site documents the OSS worker implementation that can run on its own, and the same modules are reused by the hosted **takos-private** service to offer multi-tenant deployments.

## Documentation

### REST API

Complete REST API reference for client applications (Web, mobile, etc.):

- **[REST API Overview](./api/)** - Getting started with the takos REST API
- **[Authentication](./api/auth.md)** - Login, JWT tokens, sessions
- **[Users & Friends](./api/users.md)** - Profiles, search, friend requests
- **[Posts](./api/posts.md)** - Create posts, reactions, comments
- **[Stories](./api/stories.md)** - Visual story content
- **[Communities](./api/communities.md)** - Groups, channels, invitations
- **[Chat/DM](./api/chat.md)** - Direct messages and channel messages
- **[Media](./api/media.md)** - File uploads and storage
- **[Notifications](./api/notifications.md)** - Notifications and push devices

### ActivityPub Federation

Document every HTTP surface exposed under `/ap/*`, the object schemas used for delivery, and the authentication requirements for private collections. Each endpoint description in `activitypub.md` mirrors the code paths inside `platform/src/activitypub/*`.

## Using these docs

- English and Japanese pages live side-by-side; switch languages from the nav bar when needed.
- Link directly to sections (for example `/activitypub#story-federation`) when referencing the spec from issues or PRs so reviewers can validate behavior.
- Keep this site up to date whenever ActivityPub payloads change—`docs.takos.jp` is treated as the source of truth for partners using either the OSS build or takos-private.
