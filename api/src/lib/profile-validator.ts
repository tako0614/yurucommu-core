import { checkSemverCompatibility } from "@takos/platform/server";

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

    return {
        ok: errors.length === 0,
        errors,
        warnings,
    };
}
