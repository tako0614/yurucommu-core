import {
  APP_MANIFEST_SCHEMA_VERSION,
  TAKOS_CORE_VERSION,
  TAKOS_PROFILE_SCHEMA_VERSION,
  TAKOS_UI_CONTRACT_VERSION,
  checkSemverCompatibility,
  checkSemverRange,
  parseSemver,
} from "@takos/platform/server";

export interface TakosProfile {
  schema_version: string;
  name: string;
  display_name: string;
  description: string;
  version: string;
  kind: "distro";
  base: {
    core_version: string;
    repo?: string;
  };
  activitypub: {
    contexts: string[];
    profile?: string;
    node_type?: string;
    extensions?: Array<{
      id: string;
      description?: string;
      spec_url?: string;
    }>;
  };
  ai?: {
    enabled: boolean;
    requires_external_network: boolean;
    providers: string[];
    actions: string[];
    data_policy?: {
      send_public_posts?: boolean;
      send_community_posts?: boolean;
      send_dm?: boolean;
      send_profile?: boolean;
      notes?: string;
    };
  };
  gates?: {
    core_version?: string;
    schema_version?: string;
    manifest_schema?: string;
    ui_contract?: string;
    app_version_min?: string;
    app_version_max?: string;
  };
  disabled_api_endpoints?: string[];
  metadata: {
    maintainer: {
      name: string;
      url?: string;
      email?: string;
    };
    license: string;
    repo?: string;
    docs?: string;
    homepage?: string;
  };
  runtime?: {
    supported: string[];
    default?: string;
  };
  tags?: string[];
  ui?: {
    client_repo?: string;
    theme?: string;
  };
  [key: string]: unknown;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

const NAME_REGEX = /^[a-z0-9][a-z0-9-]*$/;
const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const validateActivityPubContexts = (activitypub: TakosProfile["activitypub"]): string[] => {
  const contexts = activitypub?.contexts;
  if (!Array.isArray(contexts) || contexts.length === 0) {
    return ["activitypub.contexts must be a non-empty array of URLs"];
  }

  const errors: string[] = [];
  contexts.forEach((value, index) => {
    if (typeof value !== "string") {
      errors.push(`activitypub.contexts[${index}] must be a string`);
      return;
    }
    const candidate = value.trim();
    if (!candidate) {
      errors.push(`activitypub.contexts[${index}] must not be empty`);
      return;
    }
    try {
      const url = new URL(candidate);
      if (!["http:", "https:"].includes(url.protocol)) {
        errors.push(`activitypub.contexts[${index}] must use http(s) scheme`);
      }
    } catch {
      errors.push(`activitypub.contexts[${index}] must be an absolute URL`);
    }
  });
  return errors;
};

const validateActivityPubExtensions = (
  activitypub: TakosProfile["activitypub"],
): string[] => {
  const extensions = activitypub?.extensions;
  if (extensions === undefined) return [];
  if (!Array.isArray(extensions)) {
    return ["activitypub.extensions must be an array of extension objects"];
  }

  const errors: string[] = [];
  extensions.forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`activitypub.extensions[${index}] must be an object`);
      return;
    }
    if (!isNonEmptyString((entry as any).id)) {
      errors.push(`activitypub.extensions[${index}].id must be a non-empty string`);
    }
    if ((entry as any).description !== undefined && typeof (entry as any).description !== "string") {
      errors.push(`activitypub.extensions[${index}].description must be a string when provided`);
    }
    if ((entry as any).spec_url !== undefined) {
      const spec = (entry as any).spec_url;
      if (typeof spec !== "string" || !spec.trim()) {
        errors.push(`activitypub.extensions[${index}].spec_url must be a non-empty string when provided`);
      } else {
        try {
          const url = new URL(spec);
          if (!["http:", "https:"].includes(url.protocol)) {
            errors.push(`activitypub.extensions[${index}].spec_url must use http(s) scheme`);
          }
        } catch {
          errors.push(`activitypub.extensions[${index}].spec_url must be an absolute URL`);
        }
      }
    }
  });

  return errors;
};

const validateDisabledApiEndpoints = (disabled: unknown): string[] => {
  if (disabled === undefined) return [];
  if (!Array.isArray(disabled)) {
    return ["disabled_api_endpoints must be an array of strings when provided"];
  }

  const errors: string[] = [];
  disabled.forEach((value, index) => {
    if (!isNonEmptyString(value)) {
      errors.push(`disabled_api_endpoints[${index}] must be a non-empty string`);
    }
  });
  return errors;
};

const validateAiDataPolicy = (ai: TakosProfile["ai"]): string[] => {
  const policy = ai?.data_policy;
  if (policy === undefined) return [];
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    return ["ai.data_policy must be an object when provided"];
  }

  const errors: string[] = [];
  const keys: Array<keyof NonNullable<typeof policy>> = [
    "send_public_posts",
    "send_community_posts",
    "send_dm",
    "send_profile",
  ];
  keys.forEach((key) => {
    const value = (policy as Record<string, unknown>)[key as string];
    if (value !== undefined && typeof value !== "boolean") {
      errors.push(`ai.data_policy.${key} must be a boolean when provided`);
    }
  });
  if ((policy as any).notes !== undefined && typeof (policy as any).notes !== "string") {
    errors.push("ai.data_policy.notes must be a string when provided");
  }
  return errors;
};

const validateAiConfig = (ai: TakosProfile["ai"]): string[] => {
  if (ai === undefined) return [];
  const errors: string[] = [];

  if (typeof ai !== "object" || ai === null || Array.isArray(ai)) {
    return ["ai must be an object when provided"];
  }
  if (typeof ai.enabled !== "boolean") {
    errors.push("ai.enabled must be a boolean");
  }
  if (typeof ai.requires_external_network !== "boolean") {
    errors.push("ai.requires_external_network must be a boolean");
  }
  if (!Array.isArray(ai.providers) || ai.providers.length === 0) {
    errors.push("ai.providers must be a non-empty array of strings");
  } else {
    ai.providers.forEach((provider, index) => {
      if (!isNonEmptyString(provider)) {
        errors.push(`ai.providers[${index}] must be a non-empty string`);
      }
    });
  }
  if (!Array.isArray(ai.actions) || ai.actions.length === 0) {
    errors.push("ai.actions must be a non-empty array of strings");
  } else {
    ai.actions.forEach((action, index) => {
      if (!isNonEmptyString(action)) {
        errors.push(`ai.actions[${index}] must be a non-empty string`);
      }
    });
  }

  errors.push(...validateAiDataPolicy(ai));
  return errors;
};

const validateRuntime = (runtime: TakosProfile["runtime"]): string[] => {
  if (runtime === undefined) return [];
  if (runtime === null || typeof runtime !== "object" || Array.isArray(runtime)) {
    return ["runtime must be an object when provided"];
  }

  const errors: string[] = [];
  const supported = runtime.supported;
  if (!Array.isArray(supported) || supported.length === 0) {
    errors.push("runtime.supported must be a non-empty array of strings");
  } else {
    supported.forEach((entry, index) => {
      if (!isNonEmptyString(entry)) {
        errors.push(`runtime.supported[${index}] must be a non-empty string`);
      }
    });
  }
  if (runtime.default !== undefined) {
    if (!isNonEmptyString(runtime.default)) {
      errors.push("runtime.default must be a non-empty string when provided");
    } else if (Array.isArray(supported) && !supported.includes(runtime.default)) {
      errors.push("runtime.default must be one of runtime.supported");
    }
  }
  return errors;
};

const validateGates = (
  gates: TakosProfile["gates"],
  warnings: string[],
): string[] => {
  if (gates === undefined) return [];
  if (!gates || typeof gates !== "object" || Array.isArray(gates)) {
    return ["gates must be an object when provided"];
  }

  const errors: string[] = [];
  const gateStrings: Array<keyof NonNullable<typeof gates>> = [
    "core_version",
    "schema_version",
    "manifest_schema",
    "ui_contract",
    "app_version_min",
    "app_version_max",
  ];
  for (const key of gateStrings) {
    const value = (gates as Record<string, unknown>)[key as string];
    if (value !== undefined && typeof value !== "string") {
      errors.push(`gates.${key} must be a string when provided`);
    }
  }

  if (gates.core_version) {
    const compat = checkSemverRange(TAKOS_CORE_VERSION, gates.core_version, {
      context: "profile.gates.core_version",
      action: "load",
    });
    if (!compat.ok) {
      errors.push(compat.error || "gates.core_version incompatible");
    } else {
      warnings.push(...compat.warnings);
    }
  }
  if (gates.schema_version && gates.schema_version !== TAKOS_PROFILE_SCHEMA_VERSION) {
    warnings.push(
      `gates.schema_version ${gates.schema_version} differs from runtime ${TAKOS_PROFILE_SCHEMA_VERSION}`,
    );
  }
  if (gates.manifest_schema && gates.manifest_schema !== APP_MANIFEST_SCHEMA_VERSION) {
    warnings.push(
      `gates.manifest_schema ${gates.manifest_schema} differs from runtime ${APP_MANIFEST_SCHEMA_VERSION}`,
    );
  }
  if (gates.ui_contract && gates.ui_contract !== TAKOS_UI_CONTRACT_VERSION) {
    warnings.push(
      `gates.ui_contract ${gates.ui_contract} differs from runtime ${TAKOS_UI_CONTRACT_VERSION}`,
    );
  }

  if (gates.app_version_min && gates.app_version_max) {
    const compat = checkSemverCompatibility(gates.app_version_min, gates.app_version_max, {
      allowMajorMismatch: true,
      context: "profile.gates.app_version_min/max",
      action: "validate",
    });
    if (!compat.ok) {
      errors.push(compat.error || "gates.app_version_min/max invalid");
    } else {
      warnings.push(...compat.warnings);
    }
  }

  return errors;
};

const validateSemverString = (value: unknown, label: string): string[] => {
  if (!isNonEmptyString(value)) {
    return [`${label} must be a non-empty SemVer string`];
  }
  return parseSemver(value) ? [] : [`${label} must be a valid SemVer string`];
};

export function validateTakosProfile(profile: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    return { ok: false, errors: ["Profile must be an object"], warnings };
  }

  const p = profile as Partial<TakosProfile>;

  if (!p.schema_version) errors.push("Missing schema_version");
  if (!p.name) errors.push("Missing name");
  if (!p.display_name) errors.push("Missing display_name");
  if (!p.description) errors.push("Missing description");
  if (!p.version) errors.push("Missing version");
  if (!p.kind) errors.push("Missing kind");
  if (!p.base) errors.push("Missing base configuration");
  if (!p.activitypub) errors.push("Missing activitypub configuration");
  if (!p.metadata) errors.push("Missing metadata");

  if (errors.length > 0) {
    return { ok: false, errors, warnings };
  }

  if (p.name && !NAME_REGEX.test(p.name)) {
    errors.push(`Invalid name "${p.name}". Must match /^[a-z0-9][a-z0-9-]*$/`);
  }

  if (p.schema_version && p.schema_version !== TAKOS_PROFILE_SCHEMA_VERSION) {
    warnings.push(
      `schema_version ${p.schema_version} differs from runtime ${TAKOS_PROFILE_SCHEMA_VERSION}`,
    );
  }

  if (p.version) {
    errors.push(...validateSemverString(p.version, "version"));
  }

  if (p.kind !== "distro") {
    errors.push(`Invalid kind "${p.kind}". Must be "distro"`);
  }

  if (p.tags !== undefined) {
    if (!Array.isArray(p.tags)) {
      errors.push("tags must be an array when provided");
    } else {
      p.tags.forEach((tag, index) => {
        if (!isNonEmptyString(tag)) {
          errors.push(`tags[${index}] must be a non-empty string`);
        }
      });
    }
  }

  if (p.base) {
    if (!isNonEmptyString(p.base.core_version)) {
      errors.push("Missing base.core_version");
    } else {
      const compat = checkSemverRange(TAKOS_CORE_VERSION, p.base.core_version, {
        context: "base.core_version",
        action: "runtime",
      });
      if (!compat.ok) {
        errors.push(compat.error || "base.core_version incompatible with runtime");
      } else {
        warnings.push(...compat.warnings);
      }
    }
    if (p.base.repo !== undefined && !isNonEmptyString(p.base.repo)) {
      errors.push("base.repo must be a non-empty string when provided");
    }
  }

  if (p.runtime) {
    errors.push(...validateRuntime(p.runtime));
  }

  if (p.activitypub) {
    errors.push(...validateActivityPubContexts(p.activitypub));
    errors.push(...validateActivityPubExtensions(p.activitypub));
  }

  if (p.ui) {
    if (p.ui.client_repo !== undefined && !isNonEmptyString(p.ui.client_repo)) {
      errors.push("ui.client_repo must be a non-empty string when provided");
    }
    if (p.ui.theme !== undefined && !isNonEmptyString(p.ui.theme)) {
      errors.push("ui.theme must be a non-empty string when provided");
    }
  }

  errors.push(...validateDisabledApiEndpoints(p.disabled_api_endpoints));
  errors.push(...validateAiConfig(p.ai));

  if (p.metadata) {
    if (!p.metadata.maintainer?.name) {
      errors.push("Missing metadata.maintainer.name");
    }
    if (p.metadata.maintainer?.email !== undefined && !isNonEmptyString(p.metadata.maintainer.email)) {
      errors.push("metadata.maintainer.email must be a non-empty string when provided");
    }
    if (p.metadata.maintainer?.url !== undefined && !isNonEmptyString(p.metadata.maintainer.url)) {
      errors.push("metadata.maintainer.url must be a non-empty string when provided");
    }
    if (!p.metadata.license) {
      errors.push("Missing metadata.license");
    }
    const optionalMeta = ["repo", "docs", "homepage"] as const;
    optionalMeta.forEach((key) => {
      const value = (p.metadata as Record<string, unknown>)[key];
      if (value !== undefined && !isNonEmptyString(value)) {
        errors.push(`metadata.${key} must be a non-empty string when provided`);
      }
    });
  }

  errors.push(...validateGates(p.gates, warnings));

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}
