import type { Context } from "hono";
import { verifyAccessToken } from "./auth/account-auth";
import { makeData } from "./server/data-factory";

function unauthorized(c: Context) {
  return c.json({ ok: false, error: "Unauthorized" }, 401 as any);
}

export async function accessTokenGuard(c: Context, next: () => Promise<void>) {
  const authz = c.req.header("Authorization") || "";
  const store = makeData(c.env as any);
  try {
    const claims = await verifyAccessToken(c, authz);
    if (claims) {
      const user = await store.getUser(claims.userId);
      if (!user) {
        return unauthorized(c);
      }
      c.set("accessTokenUser", user);
      await next();
      return;
    }

    return unauthorized(c);
  } finally {
    await store.disconnect?.();
  }
}
