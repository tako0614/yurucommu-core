import * as React from "react";
import {
  TakosClientProvider,
  type ClientAuthState,
  type ClientAppInfo,
  type UserIdentity,
} from "@takos/app-sdk/client";
import { useAuthStatus, useMe } from "./api";
import { getBackendUrl, getJWT } from "./api-client";

function normalizeBase(input: string): string {
  return input.replace(/\/+$/, "");
}

function isAbsoluteUrl(input: string): boolean {
  return /^https?:\/\//i.test(input) || input.startsWith("data:") || input.startsWith("blob:");
}

function resolveUrl(input: RequestInfo | URL, backendUrl: string): string | RequestInfo | URL {
  if (typeof input === "string") {
    if (isAbsoluteUrl(input)) return input;
    const base = normalizeBase(backendUrl);
    const path = input.startsWith("/") ? input : `/${input}`;
    return `${base}${path}`;
  }

  if (input instanceof Request) {
    const url = input.url;
    if (isAbsoluteUrl(url)) return url;
    const base = normalizeBase(backendUrl);
    const path = url.startsWith("/") ? url : `/${url}`;
    return `${base}${path}`;
  }

  return input;
}

/**
 * Create an authenticated fetch wrapper for Apps.
 *
 * - Resolves relative URLs against the configured backend origin.
 * - Injects `Authorization: Bearer <jwt>` when available.
 * - Defaults to `credentials: "include"`.
 */
export function createAuthenticatedFetch(): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const backendUrl = getBackendUrl();
    if (!backendUrl) {
      throw new Error("BACKEND_URL not configured");
    }

    const resolved = resolveUrl(input, backendUrl);
    const headers = new Headers(
      init?.headers ??
        (input instanceof Request ? input.headers : undefined) ??
        undefined
    );

    const jwt = getJWT();
    if (jwt && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${jwt}`);
    }

    const baseInit: RequestInit = {
      ...init,
      headers,
      credentials: init?.credentials ?? "include",
    };

    if (input instanceof Request) {
      const baseRequest = new Request(resolved, input);
      const finalRequest = new Request(baseRequest, baseInit);
      return fetch(finalRequest);
    }

    return fetch(resolved, baseInit);
  };
}

export interface TakosClientRuntimeProviderProps {
  children: React.ReactNode;
  appId: string;
  version?: string;
}

/**
 * Core-side bridge that provides App SDK client context.
 * Apps should not render this directly; useFetch/useAuth/useAppInfo depend on it.
 */
export function TakosClientRuntimeProvider({
  children,
  appId,
  version = "1.0.0",
}: TakosClientRuntimeProviderProps): React.ReactElement {
  const status = useAuthStatus();
  const me = useMe();

  const isLoggedIn = status === "authenticated";
  const meUser = me();

  const userIdentity = React.useMemo<UserIdentity | null>(() => {
    if (!isLoggedIn || !meUser) return null;
    const anyUser = meUser as any;
    const avatar = anyUser.avatar_url || anyUser.avatar;
    return {
      id: meUser.id,
      handle: anyUser.handle || meUser.id,
      displayName: anyUser.displayName || meUser.display_name || "User",
      ...(avatar ? { avatar } : {}),
    };
  }, [isLoggedIn, meUser]);

  const auth = React.useMemo<ClientAuthState>(
    () => ({
      isLoggedIn,
      user: userIdentity,
    }),
    [isLoggedIn, userIdentity]
  );

  const authenticatedFetch = React.useMemo(() => createAuthenticatedFetch(), []);

  const appInfo = React.useMemo<ClientAppInfo>(
    () => ({
      appId,
      version,
    }),
    [appId, version]
  );

  return (
    <TakosClientProvider auth={auth} fetch={authenticatedFetch} appInfo={appInfo}>
      {children}
    </TakosClientProvider>
  );
}

