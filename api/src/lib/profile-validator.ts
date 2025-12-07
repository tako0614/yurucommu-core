import {
  APP_MANIFEST_SCHEMA_VERSION,
  TAKOS_CORE_VERSION,
  TAKOS_PROFILE_SCHEMA_VERSION,
  TAKOS_UI_CONTRACT_VERSION,
  checkSemverCompatibility,
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
            description: string;
            spec_url: string;
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
    };
    [key: string]: unknown;
}

export interface ValidationResult {
    ok: boolean;
    errors: string[];
    warnings: string[];
}

const NAME_REGEX = /^[a-z0-9][a-z0-9\-]*$/;

export function validateTakosProfile(profile: unknown): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!profile || typeof profile !== "object") {
        return { ok: false, errors: ["Profile must be an object"], warnings: [] };
    }

    const p = profile as Partial<TakosProfile>;

    // Required fields
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

    // Name format
    if (p.name && !NAME_REGEX.test(p.name)) {
        errors.push(`Invalid name "${p.name}". Must match /^[a-z0-9][a-z0-9\\-]*$/`);
    }

    if (p.schema_version && p.schema_version !== TAKOS_PROFILE_SCHEMA_VERSION) {
        warnings.push(
            `schema_version ${p.schema_version} differs from runtime ${TAKOS_PROFILE_SCHEMA_VERSION}`,
        );
    }

    // Kind
    if (p.kind !== "distro") {
        errors.push(`Invalid kind "${p.kind}". Must be "distro"`);
    }

    // Base core_version
    if (p.base && !p.base.core_version) {
        errors.push("Missing base.core_version");
    }

    // ActivityPub contexts
    if (p.activitypub) {
        if (!Array.isArray(p.activitypub.contexts) || p.activitypub.contexts.length === 0) {
            errors.push("activitypub.contexts must be a non-empty array of URLs");
        }
    }

    // Metadata
    if (p.metadata) {
        if (!p.metadata.maintainer?.name) {
            errors.push("Missing metadata.maintainer.name");
        }
        if (!p.metadata.license) {
            errors.push("Missing metadata.license");
        }
    }

    if (p.disabled_api_endpoints !== undefined) {
        if (!Array.isArray(p.disabled_api_endpoints)) {
            errors.push("disabled_api_endpoints must be an array when provided");
        } else {
            p.disabled_api_endpoints.forEach((item, index) => {
                if (typeof item !== "string" || !item.trim()) {
                    errors.push(`disabled_api_endpoints[${index}] must be a non-empty string`);
                }
            });
        }
    }

    if (p.ai?.data_policy !== undefined) {
        const policy = p.ai.data_policy as Record<string, unknown>;
        const keys = ["send_public_posts", "send_community_posts", "send_dm", "send_profile"];
        keys.forEach((key) => {
            const value = policy[key];
            if (value !== undefined && typeof value !== "boolean") {
                errors.push(`ai.data_policy.${key} must be a boolean when provided`);
            }
        });
        if (policy.notes !== undefined && typeof policy.notes !== "string") {
            errors.push("ai.data_policy.notes must be a string when provided");
        }
    }

    if (p.gates !== undefined) {
        if (typeof p.gates !== "object" || p.gates === null || Array.isArray(p.gates)) {
            errors.push("gates must be an object when provided");
        } else {
            const gateStrings = [
                "core_version",
                "schema_version",
                "manifest_schema",
                "ui_contract",
                "app_version_min",
                "app_version_max",
            ] as const;
            for (const key of gateStrings) {
                const value = (p.gates as Record<string, unknown>)[key];
                if (value !== undefined && typeof value !== "string") {
                    errors.push(`gates.${key} must be a string when provided`);
                }
            }

            const gates = p.gates as Record<string, string>;
            if (gates.core_version) {
                const compat = checkSemverCompatibility(TAKOS_CORE_VERSION, gates.core_version, {
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
        }
    }

    return {
        ok: errors.length === 0,
        errors,
        warnings,
    };
}
