import type { PublicAccountBindings as Bindings } from "@takos/platform/server";

export type PushWellKnownPayload = {
  instance: string;
  registrationPublicKey: string;
  webhook: {
    algorithm: string;
    publicKey: string;
  };
};

export type PushTarget =
  | { type: "gateway"; url: string; secret: string | null }
  | { type: "default"; url: string; secret: string | null }
  | { type: "none"; url: null; secret: null };

export function buildPushWellKnownPayload(env: Bindings): PushWellKnownPayload | null {
  const instance = env.INSTANCE_DOMAIN?.trim();
  const publicKey = env.PUSH_REGISTRATION_PUBLIC_KEY?.trim();
  if (!instance || !publicKey) return null;
  return {
    instance,
    registrationPublicKey: publicKey,
    webhook: {
      algorithm: "ES256",
      publicKey,
    },
  };
}

export function resolvePushTarget(
  env: Bindings,
  preference: "gateway" | "default" = "gateway",
  allowBuiltInDefault = true,
): PushTarget {
  const gatewayBase = env.PUSH_GATEWAY_URL?.trim() || "";
  const defaultUrl =
    env.DEFAULT_PUSH_SERVICE_URL?.trim() ||
    (allowBuiltInDefault ? "https://yurucommu.com/internal/push/events" : "");

  if (preference === "gateway") {
    if (gatewayBase) {
      return {
        type: "gateway",
        url: `${gatewayBase.replace(/\/$/, "")}/internal/push/events`,
        secret: env.PUSH_WEBHOOK_SECRET?.trim() || null,
      };
    }
    if (defaultUrl) {
      return {
        type: "default",
        url: defaultUrl,
        secret: env.DEFAULT_PUSH_SERVICE_SECRET?.trim() || null,
      };
    }
    return { type: "none", url: null, secret: null };
  }

  if (defaultUrl) {
    return {
      type: "default",
      url: defaultUrl,
      secret: env.DEFAULT_PUSH_SERVICE_SECRET?.trim() || null,
    };
  }

  if (gatewayBase) {
    return {
      type: "gateway",
      url: `${gatewayBase.replace(/\/$/, "")}/internal/push/events`,
      secret: env.PUSH_WEBHOOK_SECRET?.trim() || null,
    };
  }

  return { type: "none", url: null, secret: null };
}
