/**
 * takos-config.json Export/Import API
 *
 * PLAN.md 5.3 に基づくノード構成のエクスポート/インポート
 */

import { Hono } from "hono";
import type { PublicAccountBindings as Bindings } from "@takos/platform/server";
import { fail } from "@takos/platform/server";
import { auth } from "../middleware/auth";
import takosProfile from "../../../takos-profile.json";
import { ErrorCodes } from "../lib/error-codes";

const app = new Hono<{ Bindings: Bindings }>();

interface TakosConfig {
  schema_version: string;
  distro: {
    name: string;
    version: string;
    profile?: string;
  };
  instance: {
    domain: string;
    name?: string;
    description?: string;
  };
  features?: {
    registration_enabled?: boolean;
    ai_enabled?: boolean;
    push_enabled?: boolean;
  };
  ai?: {
    enabled?: boolean;
    default_provider?: string;
    enabled_actions?: string[];
    providers?: Array<{
      id: string;
      type: string;
      base_url?: string;
      model?: string;
      api_key_env?: string;
    }>;
    data_policy?: {
      send_posts?: boolean;
      send_dm?: boolean;
      send_profile?: boolean;
    };
  };
  custom?: Record<string, unknown>;
}

/**
 * GET /-/config/export
 *
 * 現在のノード構成を takos-config.json 形式でエクスポート
 * オーナーモードのみ
 */
app.get("/export", auth, async (c) => {
  try {
    const env = c.env as any;

    // 現在の構成を構築
    const config: TakosConfig = {
      schema_version: "1.0",
      distro: {
        name: takosProfile.name || "takos-oss",
        version: takosProfile.version || "0.1.0",
        profile: takosProfile.metadata?.repo,
      },
      instance: {
        domain: env.INSTANCE_DOMAIN || "localhost",
        name: env.INSTANCE_NAME,
        description: env.INSTANCE_DESCRIPTION,
      },
      features: {
        registration_enabled: env.REGISTRATION_ENABLED === "true",
        ai_enabled: env.AI_ENABLED === "true",
        push_enabled: !!env.FCM_SERVER_KEY,
      },
      ai: {
        enabled: env.AI_ENABLED === "true",
        default_provider: env.AI_DEFAULT_PROVIDER || "openai",
        enabled_actions: parseJsonEnv(env.AI_ENABLED_ACTIONS, []),
        providers: parseJsonEnv(env.AI_PROVIDERS, []),
        data_policy: {
          send_posts: env.AI_DATA_POLICY_SEND_POSTS !== "false",
          send_dm: env.AI_DATA_POLICY_SEND_DM === "true",
          send_profile: env.AI_DATA_POLICY_SEND_PROFILE !== "false",
        },
      },
      custom: parseJsonEnv(env.TAKOS_CONFIG_CUSTOM, {}),
    };

    return c.json(config);
  } catch (err) {
    console.error("Failed to export config:", err);
    return fail(c, "Failed to export config", 500);
  }
});

/**
 * POST /-/config/import
 *
 * takos-config.json をインポート
 * オーナーモードのみ
 */
app.post("/import", auth, async (c) => {
  try {
    const body = await c.req.json();

    // スキーマバージョン確認
    if (body.schema_version !== "1.0") {
      return fail(c, "Unsupported schema_version", 400, {
        code: ErrorCodes.INVALID_INPUT,
        details: { current: "1.0", provided: body.schema_version ?? null },
      });
    }

    // distro 互換性チェック
    if (body.distro?.name && body.distro.name !== takosProfile.name) {
      return fail(c, "Distro name mismatch", 400, {
        code: ErrorCodes.INVALID_INPUT,
        details: { current: takosProfile.name ?? null, provided: body.distro.name ?? null },
      });
    }

    // TODO: 実際の構成適用ロジック
    // 現状では、環境変数の動的更新はできないため、
    // 検証のみを行い、適用方法をユーザーに示す

    const instructions = generateImportInstructions(body);

    return c.json({
      success: true,
      message: "Configuration validated successfully",
      instructions,
      note: "Please update environment variables or wrangler.toml to apply this configuration",
    });
  } catch (err) {
    console.error("Failed to import config:", err);
    return fail(c, "Failed to import config", 500);
  }
});

/**
 * JSON 環境変数のパース
 */
function parseJsonEnv<T>(value: string | undefined, defaultValue: T): T {
  if (!value) return defaultValue;
  try {
    return JSON.parse(value) as T;
  } catch {
    return defaultValue;
  }
}

/**
 * インポート手順を生成
 */
function generateImportInstructions(config: TakosConfig): string[] {
  const instructions: string[] = [];

  instructions.push(`# Update wrangler.toml or environment variables:`);

  if (config.instance?.domain) {
    instructions.push(`INSTANCE_DOMAIN="${config.instance.domain}"`);
  }

  if (config.instance?.name) {
    instructions.push(`INSTANCE_NAME="${config.instance.name}"`);
  }

  if (config.features?.ai_enabled !== undefined) {
    instructions.push(`AI_ENABLED="${config.features.ai_enabled}"`);
  }

  if (config.ai?.default_provider) {
    instructions.push(`AI_DEFAULT_PROVIDER="${config.ai.default_provider}"`);
  }

  if (config.ai?.enabled_actions) {
    instructions.push(`AI_ENABLED_ACTIONS='${JSON.stringify(config.ai.enabled_actions)}'`);
  }

  if (config.ai?.providers) {
    instructions.push(`AI_PROVIDERS='${JSON.stringify(config.ai.providers)}'`);
  }

  if (config.custom) {
    instructions.push(`TAKOS_CONFIG_CUSTOM='${JSON.stringify(config.custom)}'`);
  }

  instructions.push(`\n# Then restart the worker`);

  return instructions;
}

export default app;
