import type { PublicAccountBindings as Bindings } from "@takos/platform/server";
import type { SendNotificationInput } from "@takos/platform/app/services/notification-service";
import { createNotificationService } from "../services";

export type NotifyOptions = {
  data?: Record<string, unknown> | null;
  allowDefaultPushFallback?: boolean;
  defaultPushSecret?: string;
  instanceDomain?: string;
};

/**
 * Legacy helper that delegates to NotificationService.
 * The store argument is ignored to keep backward compatibility with older call sites.
 */
export async function notify(
  _store: unknown,
  env: Bindings,
  userId: string,
  type: string,
  actorId: string,
  refType: string,
  refId: string,
  message: string,
  options: NotifyOptions = {},
): Promise<void> {
  const service = createNotificationService(env as any);
  if (!service.send) return;
  const input: SendNotificationInput = {
    recipientId: userId,
    type,
    actorId,
    refType,
    refId,
    message,
    data: options.data ?? null,
  };
  await service.send({ userId: actorId || null }, input);
}
