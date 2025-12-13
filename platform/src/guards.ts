import type { Context } from "hono";
import { makeData } from "./server/data-factory";
import { authenticateJWT, type JWTStore } from "./server/jwt";
import { fail } from "./utils/response-helpers";

function unauthorized(c: Context) {
  return fail(c, "Unauthorized", 401, { code: "UNAUTHORIZED" });
}

type JwtCapableStore = {
  getUser(id: string): Promise<any>;
  getUserJwtSecret(userId: string): Promise<string | null>;
  setUserJwtSecret?(userId: string, secret: string): Promise<void>;
};

function createJwtStoreAdapter(store: JwtCapableStore): JWTStore {
  return {
    getUser: (id: string) => store.getUser(id),
    getUserJwtSecret: (userId: string) => store.getUserJwtSecret(userId),
    setUserJwtSecret: (userId: string, secret: string) =>
      store.setUserJwtSecret
        ? store.setUserJwtSecret(userId, secret)
        : Promise.resolve(),
  };
}

export async function accessTokenGuard(c: Context, next: () => Promise<void>) {
  const store = makeData(c.env as any);
  const jwtStore = createJwtStoreAdapter(store);
  try {
    const jwtResult = await authenticateJWT(c as any, jwtStore);
    if (!jwtResult?.user) {
      return unauthorized(c);
    }
    c.set("activityPubUser", jwtResult.user);
    await next();
  } finally {
    await store.disconnect?.();
  }
}
