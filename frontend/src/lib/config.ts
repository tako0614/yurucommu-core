export type ClientMode = "hosted" | "selfHosted";

export interface ClientConfig {
  /** Current client mode */
  mode: ClientMode;
  /** Pre-resolved host handle for self-hosted deployments */
  hostHandle?: string | null;
  /** Override backend origin (falls back to window.location.origin) */
  backendOrigin?: string | null;
}

export const DEFAULT_HOST_ORIGIN = "";

const config: ClientConfig = {
  mode: "selfHosted",
  hostHandle: null,
  backendOrigin: null,
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
  const origin = config.backendOrigin ?? null;
  if (typeof origin === "string" && origin.trim() === "") {
    return null;
  }
  return origin;
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
