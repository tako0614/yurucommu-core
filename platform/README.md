# Takos Platform

Reusable domain code consumed by the takos OSS backend, the hosted
takos-private services, and all front-end clients. The package is intentionally
limited to code that is safe to use across services; deployment-specific
behaviour lives alongside the service that owns it.

## Responsibilities

- **Stories** – story schema, editor, and viewer controller for web/mobile
  clients.
- **HTTP helpers** – Hono data factories, request guards, response helpers.
- **Cryptography** – key management for ActivityPub actors.
- **ActivityPub** – core protocol implementation shared by both account
  backends.
- **Utility modules** – sanitisation, rate limiting, QR utilities, etc.

Features that are only needed by a single service (for example, Takos'
push-registration delegate) should not be added here; keep them within the
service package instead.

## Directory Layout

```
platform/
├── src/
│   ├── activitypub/      # Protocol handlers (routes, delivery, chat, etc.)
│   ├── api/              # Client-facing API helpers
│   ├── auth/             # Crypto helpers shared between services
│   ├── server/           # Hono integration utilities
│   ├── stories/          # Story editor + viewer logic
│   ├── utils/            # Misc helpers
│   ├── db-init.ts        # D1 initialisation helpers
│   ├── guards.ts         # Access-token guard used by ActivityPub routes
│   ├── subdomain.ts      # Tenant routing middleware
│   └── types.ts          # Shared binding + model types
└── package.json
```

## Usage

### Frontend modules

```ts
import {
  StoryEditor,
  type StoryEditorSnapshot,
  type Story,
} from "@takos/platform/stories/story-editor";
```

### Backend modules

```ts
import {
  activityPubRoutes,
  enqueueDeliveriesToFollowers,
} from "@takos/platform/server";
```

### ActivityPub helpers

```ts
import activityPubRoutes from "@takos/platform/activitypub/activitypub-routes";
```

## Conventions

- Keep exports additive; avoid conditional code branches tied to a specific
  deployment. If a feature is account-backend specific, implement it in the
  relevant workspace instead.
- Update the package version when the public API changes so that dependent
  workspaces can track the upgrade explicitly.
