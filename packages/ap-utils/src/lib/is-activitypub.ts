function isActivityPubMediaType(value: string): boolean {
  const v = value.toLowerCase();
  if (v.includes("application/activity+json")) return true;
  if (!v.includes("application/ld+json")) return false;
  return v.includes("https://www.w3.org/ns/activitystreams");
}

export function isActivityPubRequest(request: Request): boolean {
  const accept = request.headers.get("Accept");
  if (accept && isActivityPubMediaType(accept)) return true;

  const contentType = request.headers.get("Content-Type");
  if (contentType && isActivityPubMediaType(contentType)) return true;

  return false;
}

