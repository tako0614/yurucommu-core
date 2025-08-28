export function normalizeBaseUrl(url: string): string | null {
  let b = url.trim();
  if (!b) return null;
  if (!/^https?:\/\//i.test(b)) b = `https://${b}`;
  try {
    const u = new URL(b);
    u.hash = "";
    u.search = "";
    let p = u.pathname.replace(/\/+$/, "");
    if (p.endsWith("/provider_info")) {
      p = p.slice(0, -"/provider_info".length);
    }
    if (p === "/") p = "";
    const out = `${u.origin}${p}`.replace(/\/$/, "");
    return out;
  } catch {
    return null;
  }
}
