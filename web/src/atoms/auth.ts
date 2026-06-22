import { atom } from "jotai";
import type { Actor } from "../types/index.ts";
import { tAtom } from "./i18n.ts";
import {
  getAuthStrategy,
  type HostedInstance,
  type HostedUserInfo,
  type InstanceHealth,
} from "../lib/plugin.ts";
import { resetScopeAtom } from "./scope.ts";

export type { HostedInstance };

const authStrategy = getAuthStrategy();
export const IS_HOSTED = authStrategy.mode === "hosted";

// --- State atoms ---
export const actorAtom = atom<Actor | null>(null);
export const authLoadingAtom = atom(true);
export const authErrorAtom = atom<string | null>(null);
export const loginErrorAtom = atom<string | null>(null);
export const needsSetupAtom = atom(false);
export const instancePendingAtom = atom(false);
export const instanceMissingAtom = atom(false);
export const instanceBlockedAtom = atom(false);
export const instanceHealthAtom = atom<InstanceHealth | null>(null);
export const hostedUserAtom = atom<HostedUserInfo | null>(null);
export const instancesAtom = atom<HostedInstance[]>([]);
export const selectedInstanceIdAtom = atom<string | null>(null);
export const instancesLoadingAtom = atom(false);

// --- Action atoms ---
export const checkAuthAtom = atom(null, async (get, set) => {
  // Surface an OAuth/OIDC login failure that the callback relayed as
  // `/?error=<code>` (e.g. id_token_invalid / token_exchange_failed /
  // csrf_check_failed). The server logs the technical detail; the user just
  // needs to know the external sign-in didn't go through. Read it once and strip
  // the param so it doesn't linger across navigations or get bookmarked.
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    if (params.has("error")) {
      set(loginErrorAtom, get(tAtom)("auth.oauthLoginFailed"));
      params.delete("error");
      const qs = params.toString();
      window.history.replaceState(
        {},
        "",
        window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash,
      );
    }
  }
  try {
    // Keep the loading screen up across a retry: otherwise authError is cleared
    // while loading is already false, flashing LoginScreen for a frame before
    // the result (or a fresh authError) arrives.
    set(authLoadingAtom, true);
    set(instancesLoadingAtom, true);
    set(authErrorAtom, null);
    const result = await authStrategy.checkAuth();
    set(actorAtom, result.actor);
    set(hostedUserAtom, result.hostedUser);
    set(needsSetupAtom, result.needsSetup);
    set(instancePendingAtom, result.instancePending);
    set(instanceMissingAtom, result.instanceMissing);
    set(instanceBlockedAtom, result.instanceBlocked);
    set(instanceHealthAtom, result.instanceHealth);
    set(instancesAtom, result.instances);
    set(selectedInstanceIdAtom, result.selectedInstanceId);
  } catch (e) {
    console.error("Auth check failed:", e);
    set(actorAtom, null);
    set(authErrorAtom, get(tAtom)("auth.checkFailed"));
  } finally {
    set(authLoadingAtom, false);
    set(instancesLoadingAtom, false);
  }
});

export const loginAtom = atom(null, async (get, set, password?: string) => {
  set(loginErrorAtom, null);
  try {
    const result = await authStrategy.login(password);
    if (result.redirect) {
      window.location.href = result.redirect;
      return false;
    }
    if (result.error || result.errorKey) {
      set(loginErrorAtom, result.error ?? get(tAtom)(result.errorKey!));
      return false;
    }
    if (result.success) {
      await set(checkAuthAtom);
      return true;
    }
    return false;
  } catch (e) {
    console.error("Login error:", e);
    set(loginErrorAtom, get(tAtom)("auth.networkError"));
    return false;
  }
});

export const logoutAtom = atom(null, async (get, set) => {
  try {
    await authStrategy.logout();
  } catch (e) {
    console.error("Logout error:", e);
    set(authErrorAtom, get(tAtom)("auth.logoutFailed"));
  } finally {
    set(actorAtom, null);
    // Reset the observation scope so a switched account never inherits the
    // previous owner's community lens.
    set(resetScopeAtom);
  }
});

export const completeSetupAtom = atom(
  null,
  async (_get, set, username: string) => {
    if (!IS_HOSTED || !authStrategy.completeSetup) return false;
    const success = await authStrategy.completeSetup(username);
    if (success) await set(checkAuthAtom);
    return success;
  },
);

export const selectInstanceAtom = atom(
  null,
  async (get, set, instanceId: string) => {
    if (!IS_HOSTED || !authStrategy.selectInstance) return;
    set(instancesLoadingAtom, true);
    try {
      await authStrategy.selectInstance(instanceId);
    } catch (e) {
      console.error("Failed to select instance:", e);
      set(authErrorAtom, get(tAtom)("auth.instanceSelectFailed"));
    } finally {
      await set(checkAuthAtom);
      set(instancesLoadingAtom, false);
    }
  },
);

export const rebuildInstanceAtom = atom(
  null,
  async (get, set, instanceId: string) => {
    if (!IS_HOSTED || !authStrategy.rebuildInstance) return false;
    set(instancesLoadingAtom, true);
    try {
      return await authStrategy.rebuildInstance(instanceId);
    } catch (e) {
      console.error("Failed to rebuild instance:", e);
      set(authErrorAtom, get(tAtom)("auth.instanceRebuildFailed"));
      return false;
    } finally {
      await set(checkAuthAtom);
      set(instancesLoadingAtom, false);
    }
  },
);

// Init: extract token from URL on load
export const initAuthAtom = atom(null, async (_get, set) => {
  authStrategy.extractTokenFromUrl();
  await set(checkAuthAtom);
});
