# takos Push Service (takos-private Hosted)

`takos-private` exposes its host backend as a push aggregation gateway that any takos OSS deployment can reuse. The gateway wraps Firebase Cloud Messaging (FCM) so external instances do not need to manage their own server key. This document describes how to opt into that shared service, which is also the default fallback when an instance does not provide its own FCM credentials. Official takos mobile apps expect this gateway; without it, the apps cannot receive push notifications out of the box.

## Components

- **takos OSS Account Worker** – stores push devices in its own D1 database, signs registration payloads, and invokes the gateway when users register/deregister.
- **takos-private Host Worker** – verifies the signature, stores tokens per tenant in Cloudflare KV (`PUSH_DEVICES`), and fans out notifications to FCM using its managed credentials.
- **Mobile apps / Web clients** – call `POST /me/push-devices` so the backend can sync with the host gateway.

## Well-known Metadata

Each takos instance publishes `/.well-known/takos-push.json` from its account backend. The host gateway fetches this document to learn the public verification key and tenant identifier, so no shared secret is required.

Example:

```json
{
  "instance": "demo.example.com",
  "tenant": "demo.example.com",
  "registrationPublicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----",
  "webhook": {
    "algorithm": "ES256",
    "publicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
  }
}
```

Set `PUSH_REGISTRATION_PUBLIC_KEY` to the PEM you want to expose; the backend automatically serves the well-known JSON. The private key remains in `PUSH_REGISTRATION_PRIVATE_KEY` and never leaves your worker.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/push/register` | Accepts the signed payload from takos OSS to register/deregister tokens. |
| `POST` | `/push/webhook` | Receives notification webhook calls from takos OSS instances. |
| `POST` | `/internal/push/events` | Alias of `/push/webhook` that existing takos clients already use; preserved for compatibility. |

The production host lives at `https://yurucommu.com`, so `/push/register` resolves to `https://yurucommu.com/push/register`.

## Required Environment Variables (takos OSS)

| Name | Purpose |
|------|---------|
| `PUSH_GATEWAY_URL` | Base URL of the host gateway (e.g. `https://yurucommu.com`). |
| `PUSH_REGISTRATION_PRIVATE_KEY` | P-256 private key used to sign registration payloads. Generate it yourself and keep it secret. |
| `PUSH_REGISTRATION_PUBLIC_KEY` | Matching public key served via `/.well-known/takos-push.json`. |
| `DEFAULT_PUSH_SERVICE_URL` | Defaults to `https://yurucommu.com/internal/push/events`. Clear to disable fallback. |
| `DEFAULT_PUSH_SERVICE_SECRET` | Optional extra header for backwards compatibility; not required when signatures are enabled. |
| `PUSH_WEBHOOK_SECRET` | Optional per-instance header for custom gateways; the takos-private default no longer requires it. |

Every signed request includes `X-Push-Signature`, a base64-encoded ES256 signature over the canonical JSON payload. The takos-private host verifies this signature using the public key from your well-known metadata.

You do **not** need to configure `FCM_SERVER_KEY` locally when using the takos-private push service—the host worker handles delivery to FCM.

## Registration Flow

1. Mobile client calls `POST /me/push-devices` on the takos OSS backend with an FCM token.
2. takos OSS stores the token in D1 and invokes `buildPushRegistrationPayload`, which signs `{ action, instance, userId, token, platform, appId, issuedAt, expiresAt, nonce }`.
3. `syncPushDeviceWithHost` sends that payload to `${PUSH_GATEWAY_URL}/push/register`.
4. The host verifies the signature via the public key advertised in `/.well-known/takos-push.json`, ensures the payload is within TTL, and stores the token under `(tenant, userId)` inside KV. If you omit `tenant`, the host uses `tenant` from the well-known file (defaults to your domain).
5. Deregistration follows the same flow with `action="deregister"`.

> **Tenant identifier:** takos-private assigns each external instance a slug (e.g. `external:demo`). Use this slug as the `instance` field when building the payload; the host treats that value as the tenant key.

## Notification Flow

1. When takos OSS creates a notification, it first tries to deliver with its own `FCM_SERVER_KEY` (if configured).
2. If no direct FCM key is present, it posts the payload to the gateway and signs the JSON body with `PUSH_REGISTRATION_PRIVATE_KEY`. The signature travels in `X-Push-Signature`.
3. Host worker looks up tokens from KV and calls FCM on behalf of the OSS instance.

You can override `DEFAULT_PUSH_SERVICE_SECRET` at deployment time. Coordinate rotations with the takos-private operators so both sides stay in sync.

## Onboarding Checklist

1. **Generate a keypair:** use `npm run generate:push-key` (from takos-private) or OpenSSL to create a P-256 keypair. Store the private key via `wrangler secret put PUSH_REGISTRATION_PRIVATE_KEY` and add the public key to `wrangler.toml` as `PUSH_REGISTRATION_PUBLIC_KEY`.
2. **Expose well-known metadata:** confirm `/.well-known/takos-push.json` returns your instance domain, tenant, and public key (served automatically when both env vars are set).
3. **Configure the gateway:** set `PUSH_GATEWAY_URL` to `https://yurucommu.com` (or the host you prefer). Leave `PUSH_WEBHOOK_SECRET` unset unless you control a custom gateway.
4. **Verify registration:** call `/me/push-devices` from a dev client, confirm the response contains `registration`, and check the host logs/KV to ensure the device appears under your tenant.
5. **Send a test notification:** trigger any action that produces a notification or manually POST to `${DEFAULT_PUSH_SERVICE_URL}`; the signature in `X-Push-Signature` should validate without any shared secret.

## Opting Out

If you prefer to keep push delivery entirely inside your takos OSS deployment, configure:

- `FCM_SERVER_KEY` – so `dispatchFcmDirect` runs locally.
- (Optional) `PUSH_GATEWAY_URL` + `PUSH_WEBHOOK_SECRET` – to point to your own custom gateway.
- Unset `DEFAULT_PUSH_SERVICE_URL` or set `allowDefaultPushFallback=false` in your notify calls.

This disables the takos-private fallback while keeping the same codepaths available for future integrations.
