const normalizeRoute = (path: string): string => {
  const trimmed = (path || "").trim();
  if (!trimmed) return "";
  if (!trimmed.startsWith("/")) return `/${trimmed}`;
  return trimmed.replace(/\/+$/, "") || "/";
};

export const CORE_SCREEN_ROUTES: Record<string, string> = {
  "screen.home": "/",
  "screen.onboarding": "/onboarding",
  "screen.profile": "/profile",
  "screen.profile_edit": "/profile/edit",
  "screen.settings": "/settings",
  "screen.notifications": "/notifications",
  "screen.user_profile": "/@:handle",
};

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const segmentToRegex = (segment: string): string => {
  if (segment === "*") return ".*";
  let out = "";
  for (let i = 0; i < segment.length; i += 1) {
    const ch = segment[i];
    if (ch === ":") {
      let j = i + 1;
      while (j < segment.length && /[A-Za-z0-9_]/.test(segment[j])) j += 1;
      if (j > i + 1) {
        out += "[^/]+";
        i = j - 1;
        continue;
      }
    }
    out += escapeRegex(ch);
  }
  return out;
};

const patternToRegExp = (pattern: string): RegExp => {
  const normalized = normalizeRoute(pattern);
  if (!normalized) return /^$/;
  if (normalized === "/") return /^\/$/;
  const segments = normalized.split("/").filter(Boolean);
  const regexBody = segments.map(segmentToRegex).join("/");
  return new RegExp(`^/${regexBody}/?$`);
};

const CORE_ROUTE_MATCHERS = Object.entries(CORE_SCREEN_ROUTES).map(([screenId, path]) => {
  const normalized = normalizeRoute(path);
  return { screenId, path: normalized, matcher: patternToRegExp(normalized) };
});

export const findCoreRouteOwner = (
  route: string,
): { screenId: string; path: string } | null => {
  const normalized = normalizeRoute(route);
  if (!normalized) return null;
  for (const entry of CORE_ROUTE_MATCHERS) {
    if (entry.matcher.test(normalized)) return { screenId: entry.screenId, path: entry.path };
  }
  return null;
};

