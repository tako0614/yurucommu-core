type Locale = string | string[] | undefined;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function toDate(dateString: string): Date | null {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function getRelativeFormatter(locale: Locale) {
  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
}

export function formatRelativeTime(
  dateString: string,
  options?: { locale?: Locale; maxDays?: number }
): string {
  const date = toDate(dateString);
  if (!date) return '';

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0) {
    return date.toLocaleDateString(options?.locale);
  }

  const diffMins = Math.floor(diffMs / MINUTE_MS);
  const diffHours = Math.floor(diffMs / HOUR_MS);
  const diffDays = Math.floor(diffMs / DAY_MS);
  const maxDays = options?.maxDays ?? 7;

  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < maxDays) return `${diffDays}d`;
  return date.toLocaleDateString(options?.locale);
}

export function formatDateTime(dateString: string, locale: Locale = 'ja-JP'): string {
  const date = toDate(dateString);
  if (!date) return '';
  return date.toLocaleString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatMonthYear(dateString: string, locale: Locale = undefined): string {
  const date = toDate(dateString);
  if (!date) return '';
  return date.toLocaleDateString(locale, { year: 'numeric', month: 'long' });
}

export function formatTime(dateString: string, locale: Locale = 'ja-JP'): string {
  const date = toDate(dateString);
  if (!date) return '';
  return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

export function formatChatDateHeader(dateString: string, locale: Locale = 'ja-JP'): string {
  const date = toDate(dateString);
  if (!date) return '';
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === now.toDateString()) {
    return getRelativeFormatter(locale).format(0, 'day');
  }
  if (date.toDateString() === yesterday.toDateString()) {
    return getRelativeFormatter(locale).format(-1, 'day');
  }

  return date.toLocaleDateString(locale, { month: 'long', day: 'numeric' });
}

export function formatConversationListTime(
  dateString: string | null,
  locale: Locale = 'ja-JP'
): string {
  if (!dateString) return '';
  const date = toDate(dateString);
  if (!date) return '';

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / DAY_MS);

  if (diffDays < 1 && date.toDateString() === now.toDateString()) {
    return formatTime(dateString, locale);
  }
  if (diffDays < 7) {
    return new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date);
  }
  if (diffDays < 365) {
    return date.toLocaleDateString(locale, { month: 'numeric', day: 'numeric' });
  }
  return date.toLocaleDateString(locale, { year: 'numeric', month: 'numeric', day: 'numeric' });
}

export function formatRecentTime(dateString: string | null | undefined, locale: Locale = 'ja-JP'): string {
  if (!dateString) return '';
  const date = toDate(dateString);
  if (!date) return '';

  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / DAY_MS);

  if (diffDays === 0) {
    return formatTime(dateString, locale);
  }
  if (diffDays < 7) {
    return getRelativeFormatter(locale).format(-diffDays, 'day');
  }
  return date.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}
