export type ClientMode = "hosted" | "selfHosted";

export interface ClientConfig {
  /** Current client mode */
  mode: ClientMode;
  /** Pre-resolved host handle for self-hosted deployments */
  hostHandle?: string | null;
  /** Override backend origin (falls back to window.location.origin) */
  backendOrigin?: string | null;
}

export const DEFAULT_HOST_ORIGIN = "https://yurucommu.com";

const config: ClientConfig = {
  mode: "selfHosted",
  hostHandle: null,
  backendOrigin: DEFAULT_HOST_ORIGIN,
};

export function configureClient(partial: Partial<ClientConfig>): void {
  Object.assign(config, partial);
}

export function getClientConfig(): ClientConfig {
  return config;
}

export function isSelfHostedMode(): boolean {
  return config.mode === "selfHosted";
}

export function getConfiguredHostHandle(): string | null {
  return config.hostHandle ?? null;
}

export function getConfiguredBackendOrigin(): string | null {
  return config.backendOrigin ?? null;
}

export function getConfiguredBackendHost(): string | null {
  const origin = getConfiguredBackendOrigin();
  if (!origin) return null;
  try {
    return new URL(origin).hostname;
  } catch {
    return null;
  }
}
