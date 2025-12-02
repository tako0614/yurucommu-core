import takosProfileJson from "../../../takos-profile.json";
import appApCore from "../../../app/ap/core.json";
import type { AppApHandlerDefinition } from "@takos/platform/app";

type TakosProfile = {
  name: string;
  version: string;
  base?: { core_version?: string };
  activitypub?: {
    contexts?: unknown;
    profile?: string;
    node_type?: string;
    extensions?: unknown;
  };
};

export type ActivityPubMetadata = {
  contexts: string[];
  profile?: string;
  nodeType?: string;
  coreVersion?: string;
  distro: {
    name: string;
    version: string;
  };
  extensions: ActivityPubExtension[];
};

export type ActivityPubExtension = {
  id: string;
  description?: string;
  spec_url?: string;
};

export type ActivityPubWellKnownDocument = {
  node: string;
  core_version?: string;
  profile?: string;
  contexts: string[];
  extensions: ActivityPubExtension[];
  node_type?: string;
  distro: {
    name: string;
    version: string;
  };
};

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeContexts(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    throw new Error("activitypub.contexts must be an array");
  }

  const normalized = raw
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);

  if (normalized.length === 0) {
    throw new Error("activitypub.contexts must include at least one URL");
  }

  const invalid = normalized.filter((value) => !isHttpUrl(value));
  if (invalid.length > 0) {
    throw new Error(
      `activitypub.contexts must contain only http(s) URLs: ${invalid.join(", ")}`,
    );
  }

  return Array.from(new Set(normalized));
}

function normalizeOptionalHttpUrl(raw: unknown, label: string): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string") {
    throw new Error(`${label} must be a URL string`);
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error(`${label} must not be empty`);
  }
  if (!isHttpUrl(trimmed)) {
    throw new Error(`${label} must use http(s) scheme`);
  }
  return trimmed;
}

function normalizeExtensionEntry(raw: unknown, source: string): ActivityPubExtension {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${source} must be an object`);
  }

  const id = typeof (raw as any).id === "string" ? (raw as any).id.trim() : "";
  if (!id) {
    throw new Error(`${source}.id is required`);
  }

  const description =
    typeof (raw as any).description === "string" ? (raw as any).description.trim() : undefined;

  const specCandidate =
    typeof (raw as any).spec_url === "string"
      ? (raw as any).spec_url.trim()
      : typeof (raw as any).specUrl === "string"
        ? (raw as any).specUrl.trim()
        : undefined;
  const specUrl = normalizeOptionalHttpUrl(specCandidate, `${source}.spec_url`);

  const extension: ActivityPubExtension = { id };
  if (description) extension.description = description;
  if (specUrl) extension.spec_url = specUrl;
  return extension;
}

function normalizeExtensions(raw: unknown, source: string): ActivityPubExtension[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new Error(`${source} must be an array`);
  }
  return raw.map((entry, index) => normalizeExtensionEntry(entry, `${source}[${index}]`));
}

function normalizeAppApExtensions(
  fragments: Record<string, unknown>,
): ActivityPubExtension[] {
  const extensions: ActivityPubExtension[] = [];
  for (const [filePath, fragment] of Object.entries(fragments)) {
    const handlers = (fragment as any)?.handlers;
    if (handlers === undefined) continue;
    if (!Array.isArray(handlers)) {
      throw new Error(`${filePath} handlers must be an array`);
    }
    handlers.forEach((handler, index) => {
      extensions.push(normalizeExtensionEntry(handler, `${filePath}.handlers[${index}]`));
    });
  }
  return extensions;
}

function mergeExtensions(...sources: ActivityPubExtension[][]): ActivityPubExtension[] {
  const merged = new Map<string, ActivityPubExtension>();
  for (const source of sources) {
    for (const ext of source) {
      const existing = merged.get(ext.id);
      if (!existing) {
        merged.set(ext.id, { ...ext });
        continue;
      }
      const combined: ActivityPubExtension = { ...existing };
      if (!combined.description && ext.description) {
        combined.description = ext.description;
      }
      if (!combined.spec_url && ext.spec_url) {
        combined.spec_url = ext.spec_url;
      }
      merged.set(ext.id, combined);
    }
  }
  return Array.from(merged.values());
}

const takosProfile = takosProfileJson as TakosProfile;

const cachedMetadata: ActivityPubMetadata = (() => {
  const contexts = normalizeContexts(takosProfile.activitypub?.contexts);
  const extensionsFromProfile = normalizeExtensions(
    takosProfile.activitypub?.extensions,
    "activitypub.extensions",
  );
  const extensionsFromApp = normalizeAppApExtensions({
    "app/ap/core.json": appApCore as { handlers?: AppApHandlerDefinition[] },
  });

  return {
    contexts,
    profile: normalizeOptionalHttpUrl(takosProfile.activitypub?.profile, "activitypub.profile"),
    nodeType: takosProfile.activitypub?.node_type,
    coreVersion: takosProfile.base?.core_version,
    distro: {
      name: takosProfile.name,
      version: takosProfile.version,
    },
    extensions: mergeExtensions(extensionsFromProfile, extensionsFromApp),
  };
})();

export function getActivityPubMetadata(): ActivityPubMetadata {
  return {
    ...cachedMetadata,
    contexts: [...cachedMetadata.contexts],
    distro: { ...cachedMetadata.distro },
    extensions: cachedMetadata.extensions.map((ext) => ({ ...ext })),
  };
}

export function buildActivityPubWellKnown(
  instanceDomain: string,
): ActivityPubWellKnownDocument {
  const metadata = getActivityPubMetadata();
  const normalizedDomain = (instanceDomain || "").trim().replace(/^https?:\/\//i, "");
  if (!normalizedDomain) {
    throw new Error("instance domain is required to build activitypub metadata");
  }
  const baseUrl = `https://${normalizedDomain}`;

  return {
    node: baseUrl,
    core_version: metadata.coreVersion,
    profile: metadata.profile,
    contexts: metadata.contexts,
    extensions: metadata.extensions,
    node_type: metadata.nodeType,
    distro: metadata.distro,
  };
}
