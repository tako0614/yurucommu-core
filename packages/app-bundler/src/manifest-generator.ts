import fs from "node:fs";
import path from "node:path";
import type { AppDefinition, HandlerConfig, ScreenConfig } from "@takos/app-sdk";
import { validateManifest } from "./validator";

export type GenerateManifestOptions = {
  app: AppDefinition;
  entry: {
    client: string;
    server: string;
    styles?: string;
  };
  outputPath?: string;
  write?: boolean;
  validate?: boolean;
};

export type GeneratedManifest = {
  schema_version: "2.0";
  id: string;
  name: string;
  version: string;
  description?: string;
  entry: {
    client: string;
    server: string;
    styles?: string;
  };
  screens: Array<{
    id: string;
    path: string;
    title?: string;
    auth?: "required" | "optional";
  }>;
  handlers: Array<{
    id: string;
    method: string;
    path: string;
    auth?: "required" | "optional" | "none";
  }>;
  permissions: string[];
};

function deriveScreenId(screen: ScreenConfig): string {
  if (screen.id) return screen.id;
  if (!screen.path) return "screen.unknown";
  if (screen.path === "/") return "screen.home";
  const tokens = screen.path
    .replace(/^\//, "")
    .split("/")
    .map((segment) => {
      if (!segment) return "root";
      if (segment.startsWith(":")) return segment.slice(1);
      return segment.replace(/[^a-zA-Z0-9]+/g, "_");
    })
    .filter(Boolean);
  return `screen.${tokens.join("_")}`;
}

function deriveHandlerId(handler: HandlerConfig): string {
  if (handler.id) return handler.id;
  const pathPart = handler.path
    .replace(/^\//, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `handler.${handler.method.toLowerCase()}.${pathPart || "root"}`;
}

export function generateManifest(options: GenerateManifestOptions): GeneratedManifest {
  const { app, entry, outputPath } = options;
  const manifest: GeneratedManifest = {
    schema_version: "2.0",
    id: app.id,
    name: app.name,
    version: app.version,
    description: app.description,
    entry: {
      client: entry.client,
      server: entry.server,
      ...(entry.styles ? { styles: entry.styles } : {}),
    },
    screens: (app.screens || []).map((screen) => ({
      id: deriveScreenId(screen),
      path: screen.path,
      title: screen.title,
      auth: screen.auth,
    })),
    handlers: (app.handlers || []).map((handler) => ({
      id: deriveHandlerId(handler),
      method: handler.method,
      path: handler.path,
      auth: handler.auth,
    })),
    permissions: app.permissions ?? [],
  };

  if (options.validate !== false) {
    const result = validateManifest(manifest);
    if (!result.valid) {
      const detail = result.errors.map((e) => `${e.code}: ${e.message}`).join("\n");
      throw new Error(`Manifest validation failed:\n${detail}`);
    }
  }

  if (outputPath && options.write !== false) {
    const target = path.resolve(outputPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(manifest, null, 2), "utf8");
  }

  return manifest;
}
