import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";
import type { AppDefinition } from "@takos/app-sdk";
import { generateManifest, type GeneratedManifest } from "./manifest-generator.js";

export interface TakosPluginOptions {
  app: AppDefinition;
  manifestFile?: string;
  entry: {
    client: string;
    server: string;
    styles?: string;
  };
  validate?: boolean;
}

export function takosPlugin(options: TakosPluginOptions): Plugin {
  if (!options?.app) {
    throw new Error("takosPlugin requires an app definition");
  }
  if (!options.entry?.client || !options.entry?.server) {
    throw new Error("takosPlugin requires entry.client and entry.server");
  }

  let outDir = "dist";
  let manifestPath = options.manifestFile;
  let lastManifest: GeneratedManifest | null = null;

  return {
    name: "vite-plugin-takos",
    apply: "build",
    configResolved(config) {
      outDir = config.build.outDir || outDir;
      if (!manifestPath) {
        manifestPath = path.resolve(config.root || process.cwd(), outDir, "manifest.json");
      } else if (!path.isAbsolute(manifestPath)) {
        manifestPath = path.resolve(config.root || process.cwd(), manifestPath);
      }
    },
    closeBundle() {
      const outputPath = manifestPath || path.resolve(process.cwd(), outDir, "manifest.json");
      lastManifest = generateManifest({
        app: options.app,
        entry: options.entry,
        outputPath,
        write: true,
        validate: options.validate ?? true,
      });
    },
    writeBundle() {
      // In some build setups writeBundle fires after assets exist; ensure file still exists.
      if (!manifestPath || !lastManifest) return;
      if (!fs.existsSync(manifestPath)) {
        fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
        fs.writeFileSync(manifestPath, JSON.stringify(lastManifest, null, 2), "utf8");
      }
    },
  };
}
