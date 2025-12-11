// @takos/app-sdk - Main entry point
// Re-exports client SDK for convenience

export {
  // Provider (used by Core)
  TakosClientProvider,
  type TakosClientProviderProps,
  // Hooks (used by Apps)
  useAuth,
  useFetch,
  useAppInfo,
  // Types
  type ClientAuthState,
  type ClientAppInfo,
  type UserIdentity,
} from "./client/index.js";

// Also export all types from types/index for convenience
export type {
  // Server types (can be imported from @takos/app-sdk/server too)
  TakosApp,
  AppEnv,
  AppStorage,
  ActivityPubAPI,
  AiAPI,
  AuthInfo,
  AppInfo,
  Activity,
  AiCompleteOptions,
  AiEmbedOptions,
  AppManifest,
  AppEntry,
} from "./types/index.js";
