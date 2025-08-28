import type { Context as HonoContext } from "hono";
import { verifyDigest, verifyHttpSignature } from "./activitypub.ts";

export async function requireSignedJson<T>(
  c: HonoContext,
): Promise<{ ok: boolean; body?: T }> {
  const bodyText = await c.req.text();
  const hasContentDigest = !!c.req.header("content-digest");
  if (!hasContentDigest) return { ok: false };
  const okDigest = await verifyDigest(c.req.raw, bodyText);
  const okSig = await verifyHttpSignature(c.req.raw, bodyText);
  if (!okDigest || !okSig) {
    return { ok: false };
  }
  try {
    return { ok: true, body: JSON.parse(bodyText) as T };
  } catch {
    return { ok: false };
  }
}
