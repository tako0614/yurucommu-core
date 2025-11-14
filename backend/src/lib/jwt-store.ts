import type { JWTStore } from "@takos/platform/server";
import type { DatabaseAPI } from "./types";

// Adapts the platform JWTStore interface to the backend DatabaseAPI.
export function createJwtStoreAdapter(store: DatabaseAPI): JWTStore {
  return {
    getUser: (id: string) => {
      console.debug("jwtStore.getUser", { id, type: typeof id });
      return store.getUser(id);
    },
    getUserJwtSecret: (userId: string) => store.getUserJwtSecret(userId),
    setUserJwtSecret: (userId: string, secret: string) =>
      store.setUserJwtSecret(userId, secret),
  };
}
