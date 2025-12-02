#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const process = require("process");
const Ajv = require("ajv/dist/2020");
const addFormats = require("ajv-formats");
const semver = require("semver");

const [, , inputPath] = process.argv;
const profilePath = path.resolve(process.cwd(), inputPath || "takos-profile.json");
const schemaPath = path.resolve(__dirname, "..", "takos-profile.schema.json");

const ajv = new Ajv({
  allErrors: true,
  allowUnionTypes: true,
});
addFormats(ajv);

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

if (!semverPattern.test(profile.version) || !semver.valid(profile.version)) {
  semanticErrors.push("version must be a valid SemVer string");
}

const coreRange = profile.base?.core_version;
if (!semver.validRange(coreRange)) {
  semanticErrors.push("base.core_version must be a valid SemVer range");
} else if (!semver.satisfies("1.3.0", coreRange)) {
  semanticErrors.push("base.core_version must include version 1.3.0 or later");
}

if (profile.runtime?.default && Array.isArray(profile.runtime.supported)) {
  if (!profile.runtime.supported.includes(profile.runtime.default)) {
    semanticErrors.push("runtime.default must be one of runtime.supported");
  }
}

const contextErrors = validateActivityPubContexts(profile.activitypub);
const extensionErrors = validateActivityPubExtensions(profile.activitypub);
semanticErrors.push(...contextErrors);
semanticErrors.push(...extensionErrors);

if (semanticErrors.length > 0) {
  fail("takos-profile semantic validation failed", semanticErrors);
}

console.log(`✔ ${path.basename(profilePath)} is valid for takos-profile schema`);
