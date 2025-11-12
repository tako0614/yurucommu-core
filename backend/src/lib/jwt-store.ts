import type { JWTStore } from "@takos/platform/server";
import type { TenantScopedDatabaseAPI } from "../data";

/**
 * Adapt a tenant-scoped data store to the JWTStore interface expected by
 * platform/server helpers. The tenant context is already baked into the store,
 * so the incoming tenant_id parameter is ignored.
 */
export function createJwtStoreAdapter(
  store: TenantScopedDatabaseAPI,
): JWTStore {
  return {
    getUser: (_tenantId: string, id: string) => store.getUser(id),
    getUserJwtSecret: (_tenantId: string, userId: string) =>
      store.getUserJwtSecret(userId),
    setUserJwtSecret: (_tenantId: string, userId: string, secret: string) =>
      store.setUserJwtSecret(userId, secret),
  };
}
