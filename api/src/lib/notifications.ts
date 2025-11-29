import type { PublicAccountBindings as Bindings } from "@takos/platform/server";
import { requireInstanceDomain } from "@takos/platform/server";
import type { DatabaseAPI, NotificationInput } from "./types";
import { signPushPayload } from "./push-registration";

type NotificationStore = Pick<
  DatabaseAPI,
  "listPushDevicesByUser" | "addNotification"
>;

interface NotificationRecord extends NotificationInput {
  created_at: Date;
  read: number;
}

export interface NotifyOptions {
  allowDefaultPushFallback?: boolean;
  defaultPushSecret?: string;
  instanceDomain?: string;
}

async function dispatchFcmDirect(
  env: Bindings,
  store: NotificationStore,
  userId: string,
  notification: NotificationRecord,
): Promise<void> {
  const serverKey = env.FCM_SERVER_KEY;
  if (!serverKey) {
    console.warn("FCM_SERVER_KEY not configured");
    return;
  }

  const devices = await store.listPushDevicesByUser(userId);
  if (!devices || devices.length === 0) {
    console.log("no push devices registered for user", userId);
    return;
  }

  const tokens = Array.from(
    new Set(
      devices
        .map((device: any) => device.token)
        .filter((token: string) => token?.trim()),
    ),
  );
  if (tokens.length === 0) return;

  const title = env.PUSH_NOTIFICATION_TITLE?.trim() || "通知";
  const data: Record<string, string> = {
    notification_id: notification.id,
    type: notification.type,
    ref_type: notification.ref_type,
    ref_id: notification.ref_id,
    actor_id: notification.actor_id,
  };

  const endpoint = "https://fcm.googleapis.com/fcm/send";
  await Promise.all(
    tokens.map(async (token) => {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `key=${serverKey}`,
          },
          body: JSON.stringify({
            to: token,
            notification: {
              title,
              body: notification.message || "",
            },
            data,
          }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          console.error("FCM send failed", res.status, text);
        }
      } catch (error) {
        console.error("FCM send error", error);
      }
    }),
  );
}

export async function notify(
  store: NotificationStore,
  env: Bindings,
  userId: string,
  type: string,
  actorId: string,
  refType: string,
  refId: string,
  message: string,
  options: NotifyOptions = {},
): Promise<void> {
  const record: NotificationRecord = {
    id: crypto.randomUUID(),
    user_id: userId,
    type,
    actor_id: actorId,
    ref_type: refType,
    ref_id: refId,
    message,
    created_at: new Date(),
    read: 0,
  };
  await store.addNotification(record);

  const instanceDomain =
    options.instanceDomain ?? requireInstanceDomain(env);

  if (env.FCM_SERVER_KEY) {
    try {
      await dispatchFcmDirect(env, store, userId, record);
    } catch (error) {
      console.error("FCM direct dispatch failed", error);
    }
    return;
  }

  const payload = {
    instance: instanceDomain,
    userId,
    notification: record,
  };
  let payloadSignature: string | null = null;
  try {
    payloadSignature = await signPushPayload(env, payload);
  } catch (error) {
    console.error("failed to sign push notification payload", error);
  }

  const gateway = env.PUSH_GATEWAY_URL;
  const secret = env.PUSH_WEBHOOK_SECRET;
  if (gateway) {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (secret) headers["X-Push-Secret"] = secret;
      if (payloadSignature) headers["X-Push-Signature"] = payloadSignature;
      await fetch(`${gateway}/internal/push/events`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
    } catch (error) {
      console.error("push gateway dispatch failed", error);
    }
    return;
  }

  const allowFallback = options.allowDefaultPushFallback ?? true;
  if (!allowFallback) {
    console.warn("push gateway not configured");
    return;
  }

  try {
    const pushServiceUrl =
      env.DEFAULT_PUSH_SERVICE_URL ||
      "https://yurucommu.com/internal/push/events";
    const defaultSecret =
      options.defaultPushSecret ?? env.DEFAULT_PUSH_SERVICE_SECRET ?? "";
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (defaultSecret) headers["X-Push-Secret"] = defaultSecret;
    if (payloadSignature) headers["X-Push-Signature"] = payloadSignature;
    await fetch(pushServiceUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.error("default push service dispatch failed", error);
  }
}
