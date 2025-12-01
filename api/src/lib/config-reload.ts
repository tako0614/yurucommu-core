import type { PublicAccountBindings as Bindings, TakosConfig } from "@takos/platform/server";
import { persistConfig } from "./config-utils";
import { getTakosConfig, reloadTakosConfig } from "./runtime-config";

export type ConfigReloadStatus = Awaited<ReturnType<typeof reloadTakosConfig>>;

export type ReloadGuardResult = {
  ok: boolean;
  reload: ConfigReloadStatus;
  rolledBack: boolean;
};

export async function persistConfigWithReloadGuard(params: {
  env: Bindings;
  nextConfig: TakosConfig;
  previousConfig?: TakosConfig | null;
}): Promise<ReloadGuardResult> {
  const { env, nextConfig, previousConfig = null } = params;

  await persistConfig(env.DB, nextConfig);
  const reload = await reloadTakosConfig(env);

  if (reload.ok) {
    return { ok: true, reload, rolledBack: false };
  }

  if (previousConfig) {
    console.warn(
      `[config] reload failed, rolling back to previous config: ${reload.error || "unknown error"}`,
    );
    await persistConfig(env.DB, previousConfig);
    await getTakosConfig(env, { refresh: true, notify: false });
    return { ok: false, reload, rolledBack: true };
  }

  return { ok: false, reload, rolledBack: false };
}
