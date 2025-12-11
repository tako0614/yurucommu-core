// Client-facing exports for @takos/app-sdk/client
import * as React from "react";
import type { ClientAuthState, ClientAppInfo, UserIdentity } from "../types/index.js";

// Re-export client types
export type { ClientAuthState, ClientAppInfo, UserIdentity };

// =============================================================================
// Context
// =============================================================================

interface TakosClientContextValue {
  auth: ClientAuthState;
  fetch: typeof fetch;
  appInfo: ClientAppInfo;
}

const TakosClientContext = React.createContext<TakosClientContextValue | null>(null);

// =============================================================================
// Provider
// =============================================================================

export interface TakosClientProviderProps {
  children: React.ReactNode;
  /** Initial auth state */
  auth: ClientAuthState;
  /** Authenticated fetch function */
  fetch: typeof fetch;
  /** App information */
  appInfo: ClientAppInfo;
}

/**
 * Provider component for takos client SDK.
 * This should be rendered by the Core, not by the App.
 */
export function TakosClientProvider({
  children,
  auth,
  fetch: authenticatedFetch,
  appInfo,
}: TakosClientProviderProps): React.ReactElement {
  const value = React.useMemo(
    () => ({
      auth,
      fetch: authenticatedFetch,
      appInfo,
    }),
    [auth, authenticatedFetch, appInfo]
  );

  return (
    <TakosClientContext.Provider value={value}>
      {children}
    </TakosClientContext.Provider>
  );
}

// =============================================================================
// Hooks
// =============================================================================

function useTakosClient(): TakosClientContextValue {
  const context = React.useContext(TakosClientContext);
  if (!context) {
    throw new Error(
      "useTakosClient must be used within a TakosClientProvider. " +
      "Make sure your App is being rendered by the takos Core."
    );
  }
  return context;
}

/**
 * Hook to access authentication state.
 *
 * @example
 * ```tsx
 * function Profile() {
 *   const { user, isLoggedIn } = useAuth();
 *
 *   if (!isLoggedIn) {
 *     return <p>Please log in</p>;
 *   }
 *
 *   return <p>Welcome, {user.displayName}</p>;
 * }
 * ```
 */
export function useAuth(): ClientAuthState {
  const { auth } = useTakosClient();
  return auth;
}

/**
 * Hook to access authenticated fetch function.
 * The returned fetch automatically includes authentication headers.
 *
 * @example
 * ```tsx
 * function Timeline() {
 *   const fetch = useFetch();
 *   const [posts, setPosts] = useState([]);
 *
 *   useEffect(() => {
 *     fetch("/-/api/timeline/home")
 *       .then(r => r.json())
 *       .then(data => setPosts(data.posts));
 *   }, [fetch]);
 *
 *   return posts.map(post => <Post key={post.id} post={post} />);
 * }
 * ```
 */
export function useFetch(): typeof fetch {
  const { fetch: authenticatedFetch } = useTakosClient();
  return authenticatedFetch;
}

/**
 * Hook to access app information.
 *
 * @example
 * ```tsx
 * function Footer() {
 *   const { appId, version } = useAppInfo();
 *   return <p>App: {appId} v{version}</p>;
 * }
 * ```
 */
export function useAppInfo(): ClientAppInfo {
  const { appInfo } = useTakosClient();
  return appInfo;
}
