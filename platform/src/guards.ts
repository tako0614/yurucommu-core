import type { Context } from "hono";
import { verifyAccessToken } from "./auth/account-auth";
import { makeData } from "./server/data-factory";
import { authenticateJWT, type JWTStore } from "./server/jwt";

function unauthorized(c: Context) {
  return c.json({ ok: false, error: "Unauthorized" }, 401 as any);
}

function ensureTenantContext(c: Context, handle: string) {
  if (!c.get("tenantHandle")) {
    c.set("tenantHandle", handle);
    c.set("tenantMode", "user");
  }
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
      ensureTenantContext(c, user.id);
      c.set("accessTokenUser", user);
      await next();
      return;
    }

    const tenantHandle = c.get("tenantHandle");
    if (!tenantHandle) {
      return unauthorized(c);
    }

    const jwtStore: JWTStore = {
      getUser: (_tenantId: string, id: string) => store.getUser(id),
      getUserJwtSecret: (_tenantId: string, userId: string) =>
        store.getUserJwtSecret(userId),
      setUserJwtSecret: (_tenantId: string, userId: string, secret: string) =>
        store.setUserJwtSecret(userId, secret),
    };

    const jwtAuth = await authenticateJWT(c as any, jwtStore, tenantHandle);
    if (!jwtAuth) {
      return unauthorized(c);
    }
    ensureTenantContext(c, jwtAuth.user.id);
    c.set("accessTokenUser", jwtAuth.user);
    await next();
  } finally {
    await store.disconnect?.();
  }
}
