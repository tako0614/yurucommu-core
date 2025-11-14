import type { JWTStore } from "@takos/platform/server";
import type { InstanceScopedDatabaseAPI } from "../data";

/**
 * Adapt a instance-scoped data store to the JWTStore interface expected by
 * platform/server helpers. The instance context is already baked into the store,
 * so the incoming instance_id parameter is ignored.
 */
export function createJwtStoreAdapter(
  store: InstanceScopedDatabaseAPI,
): JWTStore {
  return {
    getUser: (_instanceId: string, id: string) => {
      console.debug("jwtStore.getUser", { id, type: typeof id });
      return store.getUser(id);
    },
    getUserJwtSecret: (_instanceId: string, userId: string) =>
      store.getUserJwtSecret(userId),
    setUserJwtSecret: (_instanceId: string, userId: string, secret: string) =>
      store.setUserJwtSecret(userId, secret),
  };
}
