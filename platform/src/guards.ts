import type { Context } from "hono";
import { verifyAccessToken } from "./auth/account-auth";
import { makeData } from "./server/data-factory";
import { authenticateJWT, type JWTStore } from "./server/jwt";

function unauthorized(c: Context) {
  return c.json({ ok: false, error: "Unauthorized" }, 401 as any);
}

function ensureInstanceContext(c: Context, handle: string) {
  if (!c.get("instanceHandle")) {
    c.set("instanceHandle", handle);
    c.set("instanceMode", "user");
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
      ensureInstanceContext(c, user.id);
      c.set("accessTokenUser", user);
      await next();
      return;
    }

    const instanceHandle = c.get("instanceHandle");
    if (!instanceHandle) {
      return unauthorized(c);
    }

    const resolveUserId = (value: unknown): string => {
      if (typeof value === "string" && value.trim()) {
        return value;
      }
      if (value && typeof (value as any)?.id === "string") {
        return (value as any).id;
      }
      return instanceHandle;
    };

    const jwtStore: JWTStore = {
      getUser: (_instanceId: string, id: string) =>
        store.getUser(instanceHandle, resolveUserId(id)),
      getUserJwtSecret: (_instanceId: string, userId: string) =>
        store.getUserJwtSecret(instanceHandle, resolveUserId(userId)),
      setUserJwtSecret: (_instanceId: string, userId: string, secret: string) =>
        store.setUserJwtSecret(instanceHandle, resolveUserId(userId), secret),
    };

    const jwtAuth = await authenticateJWT(c as any, jwtStore, instanceHandle);
    if (!jwtAuth) {
      return unauthorized(c);
    }
    ensureInstanceContext(c, jwtAuth.user.id);
    c.set("accessTokenUser", jwtAuth.user);
    await next();
  } finally {
    await store.disconnect?.();
  }
}
