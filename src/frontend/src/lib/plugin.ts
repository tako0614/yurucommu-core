import type { Actor } from '../types';

export const YURUCOMMU_FRONTEND_PLUGIN_API_VERSION = 1 as const;

export type DeploymentMode = 'hosted' | 'self-hosted';

export interface HostedUserInfo {
  id: string;
  username?: string;
  subdomain?: string;
  status?: string;
  allowed?: boolean;
}

export interface HostedInstance {
  id: string;
  subdomain: string;
  username: string;
  status: string;
  instance_url: string | null;
  last_selected_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface InstanceHealthChecks {
  worker_exists: boolean;
  d1_exists: boolean;
  r2_exists: boolean;
  kv_exists: boolean;
  runtime_health_ok: boolean;
}

export interface InstanceHealth {
  checks: InstanceHealthChecks;
  check_mode: 'cf_sync';
  timeout_ms: number;
  retries: number;
  effective_state: 'active' | 'missing' | 'provisioning' | 'updating' | 'failed' | 'blocked';
  reasons: string[];
  checked_at: string;
}

export interface AuthCheckResult {
  actor: Actor | null;
  hostedUser: HostedUserInfo | null;
  needsSetup: boolean;
  instancePending: boolean;
  instanceMissing: boolean;
  instanceBlocked: boolean;
  instanceHealth: InstanceHealth | null;
  instances: HostedInstance[];
  selectedInstanceId: string | null;
}

export interface LoginResult {
  redirect?: string;
  success?: boolean;
  error?: string;
}

export interface AuthStrategy {
  readonly mode: DeploymentMode;
  checkAuth(): Promise<AuthCheckResult>;
  login(password?: string): Promise<LoginResult>;
  logout(): Promise<void>;
  extractTokenFromUrl(): boolean;
  completeSetup?(username: string): Promise<boolean>;
  selectInstance?(instanceId: string): Promise<void>;
  rebuildInstance?(instanceId: string): Promise<boolean>;
}

export interface ApiTransport {
  resolveUrl(path: string): string;
  getAuthHeaders(path: string): Record<string, string>;
  readonly credentials: RequestCredentials;
}

export interface FrontendPluginContextV1 {
  readonly pluginCount: number;
}

export interface YurucommuFrontendPluginV1 {
  apiVersion: typeof YURUCOMMU_FRONTEND_PLUGIN_API_VERSION;
  name: string;
  setup?: (ctx: FrontendPluginContextV1) => void;
  createAuthStrategy?: () => AuthStrategy;
  createApiTransport?: () => ApiTransport;
}

const EMPTY_RESULT: AuthCheckResult = {
  actor: null,
  hostedUser: null,
  needsSetup: false,
  instancePending: false,
  instanceMissing: false,
  instanceBlocked: false,
  instanceHealth: null,
  instances: [],
  selectedInstanceId: null,
};

class DefaultSelfHostedStrategy implements AuthStrategy {
  readonly mode = 'self-hosted' as const;

  async checkAuth(): Promise<AuthCheckResult> {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      if (!res.ok) {
        return EMPTY_RESULT;
      }
      const data = await res.json() as { actor?: Actor };
      return { ...EMPTY_RESULT, actor: data.actor ?? null };
    } catch {
      return EMPTY_RESULT;
    }
  }

  async login(password?: string): Promise<LoginResult> {
    if (!password) {
      return { error: 'Password required' };
    }
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password }),
      });
      const data = await res.json() as { success?: boolean; error?: string };
      if (data.success) return { success: true };
      return { error: data.error || 'Login failed' };
    } catch {
      return { error: 'Network error' };
    }
  }

  async logout(): Promise<void> {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
    });
  }

  extractTokenFromUrl(): boolean {
    return false;
  }
}

class DefaultSelfHostedTransport implements ApiTransport {
  readonly credentials: RequestCredentials = 'include';

  resolveUrl(path: string): string {
    return path;
  }

  getAuthHeaders(_path: string): Record<string, string> {
    return {};
  }
}

let activePlugins: YurucommuFrontendPluginV1[] = [];
let pluginSetupDone = false;
let cachedStrategy: AuthStrategy | null = null;
let cachedTransport: ApiTransport | null = null;

function ensurePluginVersion(plugin: YurucommuFrontendPluginV1): void {
  if (plugin.apiVersion !== YURUCOMMU_FRONTEND_PLUGIN_API_VERSION) {
    throw new Error(
      `[yurucommu] frontend plugin "${plugin.name}" uses unsupported apiVersion=${plugin.apiVersion}. ` +
      `Expected ${YURUCOMMU_FRONTEND_PLUGIN_API_VERSION}.`
    );
  }
}

function ensurePluginSetup(): void {
  if (pluginSetupDone) return;
  const context: FrontendPluginContextV1 = {
    pluginCount: activePlugins.length,
  };
  for (const plugin of activePlugins) {
    plugin.setup?.(context);
  }
  pluginSetupDone = true;
}

export function registerYurucommuFrontendPlugin(plugin: YurucommuFrontendPluginV1): void {
  ensurePluginVersion(plugin);
  activePlugins.push(plugin);
  pluginSetupDone = false;
  cachedStrategy = null;
  cachedTransport = null;
}

export function setYurucommuFrontendPlugins(plugins: YurucommuFrontendPluginV1[]): void {
  activePlugins = [];
  for (const plugin of plugins) {
    registerYurucommuFrontendPlugin(plugin);
  }
}

export function clearYurucommuFrontendPlugin(): void {
  activePlugins = [];
  pluginSetupDone = false;
  cachedStrategy = null;
  cachedTransport = null;
}

export function getAuthStrategy(): AuthStrategy {
  if (cachedStrategy) return cachedStrategy;
  ensurePluginSetup();
  let strategy: AuthStrategy | null = null;
  for (const plugin of activePlugins) {
    if (plugin.createAuthStrategy) {
      strategy = plugin.createAuthStrategy();
    }
  }
  cachedStrategy = strategy ?? new DefaultSelfHostedStrategy();
  return cachedStrategy;
}

export function getApiTransport(): ApiTransport {
  if (cachedTransport) return cachedTransport;
  ensurePluginSetup();
  let transport: ApiTransport | null = null;
  for (const plugin of activePlugins) {
    if (plugin.createApiTransport) {
      transport = plugin.createApiTransport();
    }
  }
  cachedTransport = transport ?? new DefaultSelfHostedTransport();
  return cachedTransport;
}
