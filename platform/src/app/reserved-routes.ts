const normalizeRoute = (path: string): string => {
  const trimmed = (path || "").trim();
  if (!trimmed) return "/";
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const withoutTrailing = withSlash === "/" ? "/" : withSlash.replace(/\/+$/, "");
  return withoutTrailing || "/";
};

export const isReservedHttpPath = (path: string): boolean => {
  const normalized = normalizeRoute(path);
  if (normalized === "/login") return true;
  if (normalized === "/logout") return true;
  if (normalized === "/-/health") return true;
  if (normalized === "/-" || normalized.startsWith("/-/")) return true;
  if (normalized === "/auth" || normalized.startsWith("/auth/")) return true;
  if (normalized === "/.well-known" || normalized.startsWith("/.well-known/")) return true;
  return false;
};
