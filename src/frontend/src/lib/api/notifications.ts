import type { Notification } from '../../types';
import { normalizeNotification } from './normalize';

export async function fetchNotifications(options?: { limit?: number; type?: string }): Promise<Notification[]> {
  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', options.limit.toString());
  if (options?.type && options.type !== 'all') params.set('type', options.type);
  const query = params.toString() ? `?${params}` : '';
  const res = await fetch(`/api/notifications${query}`);
  const data = await res.json();
  return (data.notifications || []).map(normalizeNotification);
}

export async function fetchUnreadCount(): Promise<number> {
  const res = await fetch('/api/notifications/unread/count');
  const data = await res.json();
  return data.count || 0;
}

export async function markNotificationsRead(ids?: string[]): Promise<void> {
  const res = await fetch('/api/notifications/read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error('Failed to mark as read');
}
