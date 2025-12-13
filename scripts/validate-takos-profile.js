#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const process = require("process");
const Ajv = require("ajv/dist/2020");
const addFormats = require("ajv-formats");
const semver = require("semver");

const [, , inputPath] = process.argv;
const profilePath = path.resolve(process.cwd(), inputPath || "takos-profile.json");
const workspaceRoot = path.resolve(__dirname, "..");
const schemaCandidates = [
  path.resolve(workspaceRoot, "schemas", "profile.schema.json"),
  path.resolve(workspaceRoot, "takos-profile.schema.json"),
];
const schemaPath = schemaCandidates.find((candidate) => fs.existsSync(candidate));

const ajv = new Ajv({
  allErrors: true,
  allowUnionTypes: true,
});
addFormats(ajv);

const RUNTIME_CORE_VERSION = "1.10.0";
const PROFILE_SCHEMA_VERSION = "1.10";
const MANIFEST_SCHEMA_VERSION = "1.10";
const UI_CONTRACT_VERSION = "1.10";

const semverPattern = new RegExp(
  "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$"
);

function validateActivityPubContexts(activitypub) {
  const contexts = activitypub?.contexts;
  if (!Array.isArray(contexts) || contexts.length === 0) {
    return ["activitypub.contexts must be a non-empty array of URLs"];
  }

  const errors = [];

  contexts.forEach((value, index) => {
    if (typeof value !== "string") {
      errors.push(`activitypub.contexts[${index}] must be a string`);
      return;
    }
    const candidate = value.trim();
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
}

function validateActivityPubExtensions(activitypub) {
  const extensions = activitypub?.extensions;
  if (extensions === undefined) return [];
  if (!Array.isArray(extensions)) {
    return ["activitypub.extensions must be an array of extension objects"];
  }

  const errors = [];
  extensions.forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`activitypub.extensions[${index}] must be an object`);
      return;
    }
    if (typeof entry.id !== "string" || !entry.id.trim()) {
      errors.push(`activitypub.extensions[${index}].id must be a non-empty string`);
    }
    if (entry.description !== undefined && typeof entry.description !== "string") {
      errors.push(`activitypub.extensions[${index}].description must be a string when provided`);
    }
    if (entry.spec_url !== undefined) {
      if (typeof entry.spec_url !== "string") {
        errors.push(`activitypub.extensions[${index}].spec_url must be a string URL`);
        return;
      }
      const candidate = entry.spec_url.trim();
      if (!candidate) {
        errors.push(`activitypub.extensions[${index}].spec_url must not be empty`);
        return;
      }
      try {
        const url = new URL(candidate);
        if (!["http:", "https:"].includes(url.protocol)) {
          errors.push(`activitypub.extensions[${index}].spec_url must use http(s) scheme`);
        }
      } catch {
        errors.push(`activitypub.extensions[${index}].spec_url must be an absolute URL`);
      }
    }
  });

  return errors;
}

function validateDisabledEndpoints(disabled) {
  if (disabled === undefined) return [];
  if (!Array.isArray(disabled)) {
    return ["disabled_api_endpoints must be an array of strings when provided"];
  }
  const errors = [];
  disabled.forEach((value, index) => {
    if (typeof value !== "string" || !value.trim()) {
      errors.push(`disabled_api_endpoints[${index}] must be a non-empty string`);
    }
  });
  return errors;
}

function validateAiDataPolicy(ai) {
  const policy = ai?.data_policy;
  if (policy === undefined) return [];
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    return ["ai.data_policy must be an object when provided"];
  }

  const errors = [];
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
  return errors;
}

function validateGates(gates) {
  if (gates === undefined) return { errors: [], warnings: [] };
  if (!gates || typeof gates !== "object" || Array.isArray(gates)) {
    return { errors: ["gates must be an object when provided"], warnings: [] };
  }

  const errors = [];
  const warnings = [];

  const stringKeys = [
    "core_version",
    "schema_version",
    "manifest_schema",
    "ui_contract",
    "app_version_min",
    "app_version_max",
  ];
  for (const key of stringKeys) {
    const value = gates[key];
    if (value !== undefined && typeof value !== "string") {
      errors.push(`gates.${key} must be a string when provided`);
    }
  }

  if (gates.core_version && !semver.satisfies(RUNTIME_CORE_VERSION, gates.core_version, { includePrerelease: true })) {
    errors.push(`gates.core_version must include runtime core ${RUNTIME_CORE_VERSION}`);
  }
  if (gates.schema_version && gates.schema_version !== PROFILE_SCHEMA_VERSION) {
    warnings.push(
      `gates.schema_version (${gates.schema_version}) differs from runtime schema ${PROFILE_SCHEMA_VERSION}`,
    );
  }
  if (gates.manifest_schema && gates.manifest_schema !== MANIFEST_SCHEMA_VERSION) {
    warnings.push(
      `gates.manifest_schema (${gates.manifest_schema}) differs from runtime manifest schema ${MANIFEST_SCHEMA_VERSION}`,
    );
  }
  if (gates.ui_contract && gates.ui_contract !== UI_CONTRACT_VERSION) {
    warnings.push(
      `gates.ui_contract (${gates.ui_contract}) differs from runtime UI contract ${UI_CONTRACT_VERSION}`,
    );
  }

  if (gates.app_version_min && gates.app_version_max) {
    if (!semver.valid(gates.app_version_min) || !semver.valid(gates.app_version_max)) {
      warnings.push("gates.app_version_min/max should be valid SemVer strings");
    } else if (semver.gt(gates.app_version_min, gates.app_version_max)) {
      errors.push("gates.app_version_min must be <= gates.app_version_max");
    }
  }

  return { errors, warnings };
}

function fail(message, details = []) {
  if (details.length > 0) {
    details.forEach((detail) => {
      console.error(`- ${detail}`);
    });
  }
  console.error(message);
  process.exit(1);
}

function readJson(filePath, label) {
  try {
    const contents = fs.readFileSync(filePath, "utf8");
    return JSON.parse(contents);
  } catch (error) {
    fail(`Failed to read ${label} at ${filePath}: ${error.message}`);
  }
}

if (!schemaPath) {
  fail(`Failed to locate takos-profile schema (tried: ${schemaCandidates.join(", ")})`);
}

const schema = readJson(schemaPath, "schema");
const profile = readJson(profilePath, "profile");

const validate = ajv.compile(schema);
const isSchemaValid = validate(profile);

if (!isSchemaValid) {
  const schemaErrors = (validate.errors || []).map((error) => {
    const location = error.instancePath || "/";
    return `${location} ${error.message || ""}`.trim();
  });
  fail("takos-profile schema validation failed", schemaErrors);
}

const semanticErrors = [];
const semanticWarnings = [];

if (!semverPattern.test(profile.version) || !semver.valid(profile.version)) {
  semanticErrors.push("version must be a valid SemVer string");
}

const coreRange = profile.base?.core_version;
if (!semver.validRange(coreRange)) {
  semanticErrors.push("base.core_version must be a valid SemVer range");
} else if (!semver.satisfies(RUNTIME_CORE_VERSION, coreRange)) {
  semanticErrors.push(`base.core_version must include runtime core ${RUNTIME_CORE_VERSION} or later`);
}

if (profile.runtime?.default && Array.isArray(profile.runtime.supported)) {
  if (!profile.runtime.supported.includes(profile.runtime.default)) {
    semanticErrors.push("runtime.default must be one of runtime.supported");
  }
}

const contextErrors = validateActivityPubContexts(profile.activitypub);
const extensionErrors = validateActivityPubExtensions(profile.activitypub);
const disabledEndpointErrors = validateDisabledEndpoints(profile.disabled_api_endpoints);
const dataPolicyErrors = validateAiDataPolicy(profile.ai);
semanticErrors.push(...contextErrors);
semanticErrors.push(...extensionErrors);
semanticErrors.push(...disabledEndpointErrors);
semanticErrors.push(...dataPolicyErrors);

const gateCheck = validateGates(profile.gates);
semanticErrors.push(...(gateCheck.errors || []));
if (gateCheck.warnings?.length) {
  semanticWarnings.push(...gateCheck.warnings);
}

if (semanticErrors.length > 0) {
  fail("takos-profile semantic validation failed", semanticErrors);
}

if (semanticWarnings.length > 0) {
  semanticWarnings.forEach((warning) => {
    console.warn(`- warning: ${warning}`);
  });
}

console.log(`✔ ${path.basename(profilePath)} is valid for takos-profile schema`);
