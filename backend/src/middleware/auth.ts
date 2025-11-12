// Authentication middleware shared across routes

import type { Next } from "hono";
import type {
  AppContext,
  PublicAccountBindings as Bindings,
} from "@takos/platform/server";
import { fail, releaseStore, authenticateJWT } from "@takos/platform/server";
import { makeData } from "../data";
import { createJwtStoreAdapter } from "../lib/jwt-store";

type AuthContext = AppContext<Bindings> & {
  env: Bindings;
};

export const auth = async (c: AuthContext, next: Next) => {
  const store = makeData(c.env, c);
  const jwtStore = createJwtStoreAdapter(store);
  try {
    const result = await authenticateJWT(c, jwtStore);
    if (!result) return fail(c, "Unauthorized", 401);
    const tenantMode = c.get("tenantMode");
    const tenantHandle = c.get("tenantHandle");
    if (tenantMode !== "user" || !tenantHandle) {
      return fail(
        c,
        "This endpoint must be accessed via user subdomain (e.g., alice.example.com)",
        404,
      );
    }
    if ((result.user as any)?.id !== tenantHandle) {
      return fail(c, "tenant mismatch", 403);
    }
    c.set("user", result.user);
    await next();
  } finally {
    await releaseStore(store);
  }
};
