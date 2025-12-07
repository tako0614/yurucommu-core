/**
 * Notification Service API
 *
 * Push/アプリ内通知の統一インターフェース
 */

import type { AppAuthContext } from "../runtime/types";
import type { NotificationEntry } from "./user-service";

export interface SendNotificationInput {
  recipientId: string;
  type: string;
  actorId?: string | null;
  refType?: string | null;
  refId?: string | null;
  message?: string | null;
  data?: Record<string, unknown> | null;
}

export interface NotificationService {
  /**
   * 通知一覧
   */
  list(ctx: AppAuthContext, params?: { since?: string }): Promise<NotificationEntry[]>;

  /**
   * 通知の既読化
   */
  markRead(ctx: AppAuthContext, id: string): Promise<{ id: string; unread_count?: number }>;

  /**
   * 通知送信（存在する場合のみ実装）
   */
  send?(ctx: AppAuthContext, input: SendNotificationInput): Promise<void>;
}

export type NotificationServiceFactory = (env: unknown) => NotificationService;
