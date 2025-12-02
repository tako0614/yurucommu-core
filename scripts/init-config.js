#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const args = new Set(process.argv.slice(2));
const force = args.has("--force") || args.has("-f");
const plainJson = args.has("--no-comments") || args.has("--json");
const cwd = process.cwd();

const profilePath = path.join(cwd, "takos-profile.json");
const configPath = path.join(cwd, "takos-config.json");

const profileTemplate = `{
  // Required: keep schema version at 1.0
  "schema_version": "1.0",
  // Required: distro id (^[a-z0-9][a-z0-9\\-]*$)
  "name": "your-distro-id",
  // Required: human readable name (1-128 chars)
  "display_name": "Your Distro Name",
  // Required: short description (1-512 chars)
  "description": "Describe what this takos distro offers.",
  // Required: distro SemVer (e.g., 0.1.0)
  "version": "0.1.0",
  // Required: always \\"distro\\" for schema 1.0
  "kind": "distro",
  // Optional: classification tags
  "tags": ["oss", "custom"],
  // Required: takos-core compatibility
  "base": {
    // Required: SemVer range that includes 1.3.0+
    "core_version": ">=1.3.0 <2.0.0",
    // Required: takos-core repository URL
    "repo": "https://github.com/your-org/takos-core",
    // Optional: pinned commit hash
    "commit": "abcdef1234567890"
  },
  // Optional: runtime hints for this distro
  "runtime": {
    // Required inside runtime: list supported runtimes
    "supported": ["cloudflare-workers"],
    // Optional: default runtime (must be in supported)
    "default": "cloudflare-workers"
  },
  // Required: ActivityPub / JSON-LD metadata
  "activitypub": {
    // Required: one or more absolute JSON-LD context URLs
    "contexts": [
      "https://node.example.com/ap/context/takos-core.jsonld"
    ],
    // Optional: specification / profile URL
    "profile": "https://node.example.com/docs/takos-distro",
    // Optional: node type label
    "node_type": "takos-node",
    // Optional: ActivityPub extensions published by this distro
    "extensions": [
      {
        "id": "custom-extension",
        "description": "Describe any custom ActivityPub mappings or vocabulary.",
        "spec_url": "https://node.example.com/docs/ap/custom-extension"
      }
    ]
  },
  // Optional: UI metadata (reference only)
  "ui": {
    "client_repo": "https://github.com/your-org/takos-frontend",
    "theme": "standard"
  },
  // Optional: AI capabilities provided by this distro
  "ai": {
    "enabled": true,
    "requires_external_network": true,
    "providers": ["openai"],
    "actions": ["ai.summary"]
  },
  // Required: maintainer / license metadata
  "metadata": {
    "maintainer": {
      // Required: maintainer name
      "name": "Your Team",
      // Optional contact fields
      "email": "ops@example.com",
      "url": "https://example.com"
    },
    // Required: SPDX license id
    "license": "AGPL-3.0-or-later",
    "homepage": "https://example.com",
    "repo": "https://github.com/your-org/takos",
    "docs": "https://example.com/docs"
  }
}
`;

const configTemplate = `{
  // Required: keep schema version at 1.0
  "schema_version": "1.0",
  // Required: must match takos-profile.json
  "distro": {
    "name": "takos-oss",
    "version": "0.1.0"
  },
  // Required: node metadata
  "node": {
    // Required: public origin of this node
    "url": "https://node.example.com",
    // Optional: display name
    "instance_name": "Example Node",
    // Optional: BCP47 language tag
    "default_language": "ja-JP",
    // Optional: registration policy
    "registration": {
      "mode": "invite-only"
    }
  },
  // Optional: UI look & feel
  "ui": {
    "theme": "standard",
    "accent_color": "#0080ff",
    "logo_url": "/static/logo.svg",
    "allow_custom_css": false
  },
  // Optional: federation controls
  "activitypub": {
    "federation_enabled": true,
    "blocked_instances": ["spam.example"],
    "outbox_signing": {
      "require_http_signatures": true
    }
  },
  // Optional: AI routing and policy
  "ai": {
    "enabled": false,
    "requires_external_network": true,
    "default_provider": "openai-main",
    "enabled_actions": ["ai.summary"],
    "providers": {
      "openai-main": {
        // Required: provider type
        "type": "openai",
        // Optional: override base URL
        "base_url": "https://api.openai.com/v1",
        // Optional: default model id
        "model": "gpt-5.1-mini",
        // Optional: env var holding the API key
        "api_key_env": "OPENAI_API_KEY"
      }
    },
    // Optional: node-level data policy (upper bound)
    "data_policy": {
      "send_public_posts": true,
      "send_community_posts": true,
      "send_dm": false,
      "send_profile": false,
      "notes": "Keep DM forwarding disabled unless explicitly approved."
    }
  },
  // Optional: distro-specific overrides
  "custom": {}
}
`;

function stripJsonc(template) {
  return template
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

function writeTemplate(targetPath, template) {
  if (!force && fs.existsSync(targetPath)) {
    console.log(`- Skipped ${path.basename(targetPath)} (already exists, use --force to overwrite)`);
    return;
  }

  const contents = plainJson ? stripJsonc(template) : template;
  fs.writeFileSync(targetPath, contents.trimEnd() + "\n", "utf8");
  console.log(`- Wrote ${path.basename(targetPath)}${plainJson ? " (comments stripped)" : ""}`);
}

console.log("Generating takos-profile.json and takos-config.json templates...");
if (!plainJson) {
  console.log("Note: templates include // comments. Use --no-comments to emit plain JSON.");
}

writeTemplate(profilePath, profileTemplate);
writeTemplate(configPath, configTemplate);
