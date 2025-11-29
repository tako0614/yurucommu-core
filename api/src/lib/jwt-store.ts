import type { JWTStore } from "@takos/platform/server";
import type { DatabaseAPI } from "./types";

// Adapts the platform JWTStore interface to the backend DatabaseAPI.
export function createJwtStoreAdapter(store: DatabaseAPI): JWTStore {
  return {
    getUser: async (id: string) => {
      const started = performance.now();
      const result = await store.getUser(id);
      const ms = Number((performance.now() - started).toFixed(2));
      console.debug("jwtStore.getUser", { id, type: typeof id, ms });
      return result;
    },
    getUserJwtSecret: async (userId: string) => {
      const started = performance.now();
      const result = await store.getUserJwtSecret(userId);
      const ms = Number((performance.now() - started).toFixed(2));
      console.debug("jwtStore.getUserJwtSecret", { userId, ms });
      return result;
    },
    setUserJwtSecret: async (userId: string, secret: string) => {
      const started = performance.now();
      const result = await store.setUserJwtSecret(userId, secret);
      const ms = Number((performance.now() - started).toFixed(2));
      console.debug("jwtStore.setUserJwtSecret", { userId, ms });
      return result;
    },
  };
}
