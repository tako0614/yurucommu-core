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

// Compact relative-time labels per UI language. The Twitter-style compact form
// ("2h") is intentional (it has to fit the timeline header), so we localize the
// suffix rather than switch to Intl.RelativeTimeFormat's verbose "2 hours ago".
const RELATIVE_LABELS = {
  ja: {
    now: "今",
    m: (n: number) => `${n}分`,
    h: (n: number) => `${n}時間`,
    d: (n: number) => `${n}日`,
  },
  en: {
    now: "now",
    m: (n: number) => `${n}m`,
    h: (n: number) => `${n}h`,
    d: (n: number) => `${n}d`,
  },
} as const;

function relativeLabels(locale: Locale) {
  const key = Array.isArray(locale) ? locale[0] : (locale ?? "");
  return key.startsWith("ja") ? RELATIVE_LABELS.ja : RELATIVE_LABELS.en;
}

export function formatRelativeTime(
  dateString: string,
  options?: { locale?: Locale; maxDays?: number },
): string {
  const date = toDate(dateString);
  if (!date) return "";

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0) {
    return date.toLocaleDateString(options?.locale);
  }

  const diffMins = Math.floor(diffMs / MINUTE_MS);
  const diffHours = Math.floor(diffMs / HOUR_MS);
  const diffDays = Math.floor(diffMs / DAY_MS);
  const maxDays = options?.maxDays ?? 7;
  const labels = relativeLabels(options?.locale);

  if (diffMins < 1) return labels.now;
  if (diffMins < 60) return labels.m(diffMins);
  if (diffHours < 24) return labels.h(diffHours);
  if (diffDays < maxDays) return labels.d(diffDays);
  return date.toLocaleDateString(options?.locale);
}

export function formatDateTime(
  dateString: string,
  locale: Locale = "ja-JP",
): string {
  const date = toDate(dateString);
  if (!date) return "";
  return date.toLocaleString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatMonthYear(
  dateString: string,
  // Default to ja-JP like the sibling formatters (not `undefined`, which falls
  // back to the runtime's locale and leaked an English month — "June 2026" — into
  // the Japanese UI). Callers pass the live app language for correct ja/en output.
  locale: Locale = "ja-JP",
): string {
  const date = toDate(dateString);
  if (!date) return "";
  return date.toLocaleDateString(locale, { year: "numeric", month: "long" });
}

export function formatTime(
  dateString: string,
  locale: Locale = "ja-JP",
): string {
  const date = toDate(dateString);
  if (!date) return "";
  return date.toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatConversationListTime(
  dateString: string | null,
  locale: Locale = "ja-JP",
): string {
  if (!dateString) return "";
  const date = toDate(dateString);
  if (!date) return "";

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / DAY_MS);

  if (diffDays < 1 && date.toDateString() === now.toDateString()) {
    return formatTime(dateString, locale);
  }
  if (diffDays < 7) {
    return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(date);
  }
  if (diffDays < 365) {
    return date.toLocaleDateString(locale, {
      month: "numeric",
      day: "numeric",
    });
  }
  return date.toLocaleDateString(locale, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
}
