import type { MiddlewareHandler } from "hono";

const normalizePathname = (pathname: string): string => {
  const trimmed = (pathname || "").trim();
  if (!trimmed) return "/";
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const withoutTrailing = withSlash === "/" ? "/" : withSlash.replace(/\/+$/, "");
  return withoutTrailing || "/";
};

const mapLegacyPath = (pathname: string): string | null => {
  const normalized = normalizePathname(pathname);
  if (normalized === "/friends") return "/connections";
  if (normalized === "/friend-requests") return "/follow-requests";
  if (normalized === "/dm") return "/chat";

  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 2 && segments[0] === "dm") {
    return `/chat/dm/${segments[1]}`;
  }

  if (segments.length === 3 && segments[0] === "c" && segments[2] === "chat") {
    return `/chat/community/${segments[1]}`;
  }

  return null;
};

export const legacyRedirectMiddleware: MiddlewareHandler = async (c, next) => {
  const method = (c.req.method || "").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    await next();
    return;
  }

  const url = new URL(c.req.url);
  const target = mapLegacyPath(url.pathname);
  if (!target) {
    await next();
    return;
  }

  url.pathname = target;
  return c.redirect(url.toString(), 308);
};

