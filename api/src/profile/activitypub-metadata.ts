import takosProfileJson from "../../../takos-profile.json";

type TakosProfile = {
  name: string;
  version: string;
  base?: { core_version?: string };
  activitypub?: {
    contexts?: unknown;
    profile?: string;
    node_type?: string;
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

const takosProfile = takosProfileJson as TakosProfile;

const cachedMetadata: ActivityPubMetadata = (() => {
  const contexts = normalizeContexts(takosProfile.activitypub?.contexts);

  return {
    contexts,
    profile: takosProfile.activitypub?.profile,
    nodeType: takosProfile.activitypub?.node_type,
    coreVersion: takosProfile.base?.core_version,
    distro: {
      name: takosProfile.name,
      version: takosProfile.version,
    },
  };
})();

export function getActivityPubMetadata(): ActivityPubMetadata {
  return {
    ...cachedMetadata,
    contexts: [...cachedMetadata.contexts],
    distro: { ...cachedMetadata.distro },
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
    extensions: [],
    node_type: metadata.nodeType,
    distro: metadata.distro,
  };
}
