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
    c.set("user", result.user);
    await next();
  } finally {
    await releaseStore(store);
  }
};
