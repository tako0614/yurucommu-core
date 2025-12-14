import {
  APP_MANIFEST_SCHEMA_VERSION,
  TAKOS_CORE_VERSION,
  TAKOS_PROFILE_SCHEMA_VERSION,
  TAKOS_UI_CONTRACT_VERSION,
} from "./versions.js";
import { checkSemverCompatibility, checkSemverRange } from "../utils/semver.js";

export const TAKOS_CONFIG_SCHEMA_VERSION = "1.0";

export type TakosRegistrationMode = "open" | "invite-only" | "closed";

export type TakosRegistrationConfig = {
  mode: TakosRegistrationMode;
  [key: string]: unknown;
};

export type TakosNodeConfig = {
  url: string;
  instance_name?: string;
  default_language?: string;
  registration?: TakosRegistrationConfig;
  [key: string]: unknown;
};

export type TakosUiConfig = {
  theme?: string;
  accent_color?: string;
  logo_url?: string;
  allow_custom_css?: boolean;
  [key: string]: unknown;
};

export type TakosActivityPubOutboxSigningConfig = {
  require_http_signatures?: boolean;
  [key: string]: unknown;
};

export type TakosActivityPubConfig = {
  federation_enabled?: boolean;
  blocked_instances?: string[];
  outbox_signing?: TakosActivityPubOutboxSigningConfig;
  [key: string]: unknown;
};

export type TakosApiConfig = {
  disabled_api_endpoints?: string[];
  [key: string]: unknown;
};

export type TakosVersionGates = {
  core_version?: string;
  schema_version?: string;
  manifest_schema?: string;
  ui_contract?: string;
  app_version_min?: string;
  app_version_max?: string;
  [key: string]: unknown;
};

export type AiProviderType =
  | "openai"
  | "claude"
  | "gemini"
  | "openrouter"
  | "openai-compatible";

export type TakosAiProviderConfig = {
  type: AiProviderType;
  base_url?: string;
  model?: string;
  api_key_env?: string;
  [key: string]: unknown;
};

export type TakosAiDataPolicy = {
  send_public_posts?: boolean;
  send_community_posts?: boolean;
  send_dm?: boolean;
  send_profile?: boolean;
  notes?: string;
  [key: string]: unknown;
};

export type TakosAiConfig = {
  enabled?: boolean;
  requires_external_network?: boolean;
  default_provider?: string;
  enabled_actions?: string[];
  providers?: Record<string, TakosAiProviderConfig>;
  data_policy?: TakosAiDataPolicy;
  agent_config_allowlist?: string[];
  agent_tool_allowlist?: string[];
  [key: string]: unknown;
};

export type TakosDistroReference = {
  name: string;
  version: string;
  [key: string]: unknown;
};

export type TakosConfig = {
  schema_version: string;
  distro: TakosDistroReference;
  node: TakosNodeConfig;
  api?: TakosApiConfig;
  ui?: TakosUiConfig;
  activitypub?: TakosActivityPubConfig;
  ai?: TakosAiConfig;
  gates?: TakosVersionGates;
  custom?: Record<string, unknown>;
  [key: string]: unknown;
};

export type JsonSchema = {
  $schema?: string;
  $id?: string;
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema | JsonSchema[];
  required?: string[];
  enum?: unknown[];
  const?: unknown;
  format?: string;
  pattern?: string;
  description?: string;
  additionalProperties?: boolean | JsonSchema;
  default?: unknown;
  anyOf?: JsonSchema[];
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  uniqueItems?: boolean;
};

export const DEFAULT_TAKOS_AI_CONFIG: TakosAiConfig = {
  enabled: false,
  requires_external_network: true,
  default_provider: undefined,
  enabled_actions: [],
  providers: {},
  data_policy: { send_public_posts: true, send_dm: false },
  agent_config_allowlist: [],
  agent_tool_allowlist: [],
};

const normalizeAllowlist = (allowlist?: unknown): string[] => {
  if (!Array.isArray(allowlist)) return [];
  return Array.from(
    new Set(
      allowlist
        .map((item) => (typeof item === "string" ? item : String(item ?? "")))
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
};

export function mergeTakosAiConfig(
  base?: Partial<TakosAiConfig>,
  patch?: Partial<TakosAiConfig>,
): TakosAiConfig {
  const working: Partial<TakosAiConfig> = {
    ...DEFAULT_TAKOS_AI_CONFIG,
    ...(base ?? {}),
    ...(patch ?? {}),
  };

  const mergedActions = [
    ...(DEFAULT_TAKOS_AI_CONFIG.enabled_actions ?? []),
    ...(base?.enabled_actions ?? []),
    ...(patch?.enabled_actions ?? []),
  ];

  const enabled_actions = Array.from(
    new Set(mergedActions.map((id) => String(id || "").trim()).filter(Boolean)),
  );

  const data_policy = {
    ...DEFAULT_TAKOS_AI_CONFIG.data_policy,
    ...(working.data_policy ?? {}),
  };

  const agent_config_allowlist = normalizeAllowlist(working.agent_config_allowlist);
  const agent_tool_allowlist = normalizeAllowlist(working.agent_tool_allowlist);

  return {
    ...DEFAULT_TAKOS_AI_CONFIG,
    ...working,
    enabled_actions,
    providers: working.providers ?? DEFAULT_TAKOS_AI_CONFIG.providers,
    data_policy,
    agent_config_allowlist,
    agent_tool_allowlist,
  };
}

export const takosConfigSchema: JsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.takos.dev/takos-config.json",
  type: "object",
  required: ["schema_version", "distro", "node"],
  additionalProperties: true,
  properties: {
    schema_version: { type: "string", const: TAKOS_CONFIG_SCHEMA_VERSION },
    distro: {
      type: "object",
      required: ["name", "version"],
      additionalProperties: false,
      properties: {
        name: { type: "string" },
        version: { type: "string" },
      },
    },
    node: {
      type: "object",
      required: ["url"],
      additionalProperties: true,
      properties: {
        url: { type: "string", format: "uri" },
        instance_name: { type: "string" },
        default_language: { type: "string" },
        registration: {
          type: "object",
          required: ["mode"],
          additionalProperties: false,
          properties: {
            mode: { type: "string", enum: ["open", "invite-only", "closed"] },
          },
        },
      },
    },
    ui: {
      type: "object",
      additionalProperties: true,
      properties: {
        theme: { type: "string" },
        accent_color: { type: "string", pattern: "^#?[0-9a-fA-F]{3,8}$" },
        logo_url: { type: "string" },
        allow_custom_css: { type: "boolean" },
      },
    },
    api: {
      type: "object",
      additionalProperties: true,
      properties: {
        disabled_api_endpoints: {
          type: "array",
          items: { type: "string", minLength: 1 },
          uniqueItems: true,
        },
      },
    },
    activitypub: {
      type: "object",
      additionalProperties: true,
      properties: {
        federation_enabled: { type: "boolean" },
        blocked_instances: {
          type: "array",
          items: { type: "string" },
        },
        outbox_signing: {
          type: "object",
          additionalProperties: true,
          properties: {
            require_http_signatures: { type: "boolean" },
          },
        },
      },
    },
    ai: {
      type: "object",
      additionalProperties: true,
      properties: {
        enabled: { type: "boolean" },
        requires_external_network: { type: "boolean" },
        default_provider: { type: "string" },
        enabled_actions: {
          type: "array",
          items: { type: "string" },
        },
        providers: {
          type: "object",
          additionalProperties: {
            type: "object",
            required: ["type"],
            additionalProperties: true,
            properties: {
              type: {
                type: "string",
                enum: ["openai", "claude", "gemini", "openrouter", "openai-compatible"],
              },
              base_url: { type: "string" },
              model: { type: "string" },
              api_key_env: { type: "string" },
            },
          },
        },
        data_policy: {
          type: "object",
          additionalProperties: true,
          properties: {
            send_public_posts: { type: "boolean" },
            send_community_posts: { type: "boolean" },
            send_dm: { type: "boolean" },
            send_profile: { type: "boolean" },
            notes: { type: "string" },
          },
        },
        agent_config_allowlist: {
          type: "array",
          items: { type: "string" },
        },
      },
    },
    gates: {
      type: "object",
      additionalProperties: false,
      properties: {
        core_version: { type: "string" },
        schema_version: { type: "string" },
        manifest_schema: { type: "string" },
        ui_contract: { type: "string" },
        app_version_min: { type: "string" },
        app_version_max: { type: "string" },
      },
    },
    custom: {
      type: "object",
      additionalProperties: true,
    },
  },
};

export type TakosConfigValidationResult = {
  ok: boolean;
  errors: string[];
  config?: TakosConfig;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

const REGISTRATION_MODES: TakosRegistrationMode[] = ["open", "invite-only", "closed"];

  const PROVIDER_TYPES: AiProviderType[] = [
  "openai",
  "claude",
  "gemini",
  "openrouter",
  "openai-compatible",
];

export function validateTakosConfig(config: unknown): TakosConfigValidationResult {
  const errors: string[] = [];

  if (!isRecord(config)) {
    return { ok: false, errors: ["root: expected object"] };
  }

  if (typeof config.schema_version !== "string") {
    errors.push("schema_version: expected string");
  } else if (config.schema_version !== TAKOS_CONFIG_SCHEMA_VERSION) {
    errors.push(
      `schema_version: expected ${TAKOS_CONFIG_SCHEMA_VERSION}, received ${config.schema_version}`,
    );
  }

  if (!isRecord(config.distro)) {
    errors.push("distro: expected object");
  } else {
    if (typeof config.distro.name !== "string") {
      errors.push("distro.name: expected string");
    }
    if (typeof config.distro.version !== "string") {
      errors.push("distro.version: expected string (SemVer)");
    }
  }

  if (!isRecord(config.node)) {
    errors.push("node: expected object");
  } else {
    if (typeof config.node.url !== "string") {
      errors.push("node.url: expected string");
    }
    if (config.node.registration !== undefined) {
      if (!isRecord(config.node.registration)) {
        errors.push("node.registration: expected object");
      } else if (
        typeof config.node.registration.mode !== "string" ||
        !REGISTRATION_MODES.includes(config.node.registration.mode as TakosRegistrationMode)
      ) {
        errors.push("node.registration.mode: expected \"open\" | \"invite-only\" | \"closed\"");
      }
    }
  }

  if (config.ui !== undefined) {
    if (!isRecord(config.ui)) {
      errors.push("ui: expected object");
    } else {
      if (config.ui.theme !== undefined && typeof config.ui.theme !== "string") {
        errors.push("ui.theme: expected string");
      }
      if (config.ui.accent_color !== undefined && typeof config.ui.accent_color !== "string") {
        errors.push("ui.accent_color: expected string");
      }
      if (config.ui.logo_url !== undefined && typeof config.ui.logo_url !== "string") {
        errors.push("ui.logo_url: expected string");
      }
      if (
        config.ui.allow_custom_css !== undefined &&
        typeof config.ui.allow_custom_css !== "boolean"
      ) {
        errors.push("ui.allow_custom_css: expected boolean");
      }
    }
  }

  if (config.activitypub !== undefined) {
    if (!isRecord(config.activitypub)) {
      errors.push("activitypub: expected object");
    } else {
      if (
        config.activitypub.federation_enabled !== undefined &&
        typeof config.activitypub.federation_enabled !== "boolean"
      ) {
        errors.push("activitypub.federation_enabled: expected boolean");
      }
      if (
        config.activitypub.blocked_instances !== undefined &&
        !isStringArray(config.activitypub.blocked_instances)
      ) {
        errors.push("activitypub.blocked_instances: expected string[]");
      }
      if (config.activitypub.outbox_signing !== undefined) {
        const outbox = config.activitypub.outbox_signing;
        if (!isRecord(outbox)) {
          errors.push("activitypub.outbox_signing: expected object");
        } else if (
          outbox.require_http_signatures !== undefined &&
          typeof outbox.require_http_signatures !== "boolean"
        ) {
          errors.push("activitypub.outbox_signing.require_http_signatures: expected boolean");
        }
      }
    }
  }

  if (config.api !== undefined) {
    if (!isRecord(config.api)) {
      errors.push("api: expected object");
    } else if (
      config.api.disabled_api_endpoints !== undefined &&
      !isStringArray(config.api.disabled_api_endpoints)
    ) {
      errors.push("api.disabled_api_endpoints: expected string[]");
    }
  }

  if (config.ai !== undefined) {
    if (!isRecord(config.ai)) {
      errors.push("ai: expected object");
    } else {
      if (config.ai.enabled !== undefined && typeof config.ai.enabled !== "boolean") {
        errors.push("ai.enabled: expected boolean");
      }
      if (
        config.ai.requires_external_network !== undefined &&
        typeof config.ai.requires_external_network !== "boolean"
      ) {
        errors.push("ai.requires_external_network: expected boolean");
      }
      if (
        config.ai.default_provider !== undefined &&
        typeof config.ai.default_provider !== "string"
      ) {
        errors.push("ai.default_provider: expected string");
      }
      if (config.ai.enabled_actions !== undefined && !isStringArray(config.ai.enabled_actions)) {
        errors.push("ai.enabled_actions: expected string[]");
      }
      if (config.ai.providers !== undefined) {
        if (!isRecord(config.ai.providers)) {
          errors.push("ai.providers: expected object map");
        } else {
          for (const [providerId, providerConfig] of Object.entries(config.ai.providers)) {
            if (!isRecord(providerConfig)) {
              errors.push(`ai.providers.${providerId}: expected object`);
              continue;
            }
            if (typeof providerConfig.type !== "string") {
              errors.push(`ai.providers.${providerId}.type: expected provider type`);
            } else if (!PROVIDER_TYPES.includes(providerConfig.type as AiProviderType)) {
              errors.push(
                `ai.providers.${providerId}.type: expected one of ${PROVIDER_TYPES.join(", ")}`,
              );
            }
            if (providerConfig.base_url !== undefined && typeof providerConfig.base_url !== "string") {
              errors.push(`ai.providers.${providerId}.base_url: expected string`);
            }
            if (providerConfig.model !== undefined && typeof providerConfig.model !== "string") {
              errors.push(`ai.providers.${providerId}.model: expected string`);
            }
            if (
              providerConfig.api_key_env !== undefined &&
              typeof providerConfig.api_key_env !== "string"
            ) {
              errors.push(`ai.providers.${providerId}.api_key_env: expected string`);
            }
          }
        }
      }
      if (config.ai.data_policy !== undefined) {
        if (!isRecord(config.ai.data_policy)) {
          errors.push("ai.data_policy: expected object");
        } else {
          if (
            config.ai.data_policy.send_public_posts !== undefined &&
            typeof config.ai.data_policy.send_public_posts !== "boolean"
          ) {
            errors.push("ai.data_policy.send_public_posts: expected boolean");
          }
          if (
            config.ai.data_policy.send_community_posts !== undefined &&
            typeof config.ai.data_policy.send_community_posts !== "boolean"
          ) {
            errors.push("ai.data_policy.send_community_posts: expected boolean");
          }
          if (
            config.ai.data_policy.send_dm !== undefined &&
            typeof config.ai.data_policy.send_dm !== "boolean"
          ) {
            errors.push("ai.data_policy.send_dm: expected boolean");
          }
          if (
            config.ai.data_policy.send_profile !== undefined &&
            typeof config.ai.data_policy.send_profile !== "boolean"
          ) {
            errors.push("ai.data_policy.send_profile: expected boolean");
          }
          if (
            config.ai.data_policy.notes !== undefined &&
            typeof config.ai.data_policy.notes !== "string"
          ) {
            errors.push("ai.data_policy.notes: expected string");
          }
        }
      }

      if (config.ai.agent_config_allowlist !== undefined) {
        if (!isStringArray(config.ai.agent_config_allowlist)) {
          errors.push("ai.agent_config_allowlist: expected string[]");
        } else if (config.ai.agent_config_allowlist.some((item) => item.trim().length === 0)) {
          errors.push("ai.agent_config_allowlist: entries must be non-empty strings");
        }
      }

      if (config.ai.agent_tool_allowlist !== undefined) {
        if (!isStringArray(config.ai.agent_tool_allowlist)) {
          errors.push("ai.agent_tool_allowlist: expected string[]");
        } else if (config.ai.agent_tool_allowlist.some((item) => item.trim().length === 0)) {
          errors.push("ai.agent_tool_allowlist: entries must be non-empty strings");
        }
      }
    }
  }

  if (config.gates !== undefined) {
    if (!isRecord(config.gates)) {
      errors.push("gates: expected object");
    } else {
      const gateKeys: Array<keyof typeof config.gates> = [
        "core_version",
        "schema_version",
        "manifest_schema",
        "ui_contract",
        "app_version_min",
        "app_version_max",
      ];
      for (const key of gateKeys) {
        const value = (config.gates as Record<string, unknown>)[key as string];
        if (value !== undefined && typeof value !== "string") {
          errors.push(`gates.${key}: expected string`);
        }
      }
    }
  }

  if (config.custom !== undefined && !isRecord(config.custom)) {
    errors.push("custom: expected object");
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, errors, config: config as TakosConfig };
}

export function parseTakosConfig(json: string): TakosConfig {
  const parsed = JSON.parse(json) as unknown;
  const validation = validateTakosConfig(parsed);

  if (!validation.ok || !validation.config) {
    throw new Error(`Invalid takos-config.json: ${validation.errors.join("; ")}`);
  }

  return validation.config;
}

export type ConfigVersionGateResult = {
  ok: boolean;
  warnings: string[];
  error?: string;
};

export function checkConfigVersionGates(config: TakosConfig): ConfigVersionGateResult {
  const warnings: string[] = [];
  const gates = config.gates;
  if (!gates) return { ok: true, warnings };

  if (gates.core_version) {
    const compat = checkSemverRange(TAKOS_CORE_VERSION, gates.core_version, {
      context: "core_version gate",
      action: "load",
    });
    if (!compat.ok) {
      return { ok: false, warnings, error: compat.error };
    }
    warnings.push(...compat.warnings);
  }

  if (gates.schema_version && gates.schema_version !== TAKOS_PROFILE_SCHEMA_VERSION) {
    warnings.push(
      `schema_version gate ${gates.schema_version} differs from runtime ${TAKOS_PROFILE_SCHEMA_VERSION}`,
    );
  }

  if (gates.manifest_schema && gates.manifest_schema !== APP_MANIFEST_SCHEMA_VERSION) {
    warnings.push(
      `manifest_schema gate ${gates.manifest_schema} differs from runtime ${APP_MANIFEST_SCHEMA_VERSION}`,
    );
  }

  if (gates.ui_contract && gates.ui_contract !== TAKOS_UI_CONTRACT_VERSION) {
    warnings.push(
      `ui_contract gate ${gates.ui_contract} differs from runtime ${TAKOS_UI_CONTRACT_VERSION}`,
    );
  }

  if (gates.app_version_min && gates.app_version_max) {
    const compat = checkSemverCompatibility(gates.app_version_min, gates.app_version_max, {
      context: "app version gate",
      action: "validate",
      allowMajorMismatch: true,
    });
    if (!compat.ok) {
      return { ok: false, warnings, error: compat.error };
    }
    warnings.push(...compat.warnings);
  }

  return { ok: true, warnings };
}

// NOTE: loadTakosConfig has been moved to takos-config-node.ts
// to avoid bundling Node.js modules in workerd builds.
// Import from "@takos/platform/config/takos-config-node" when needed.
