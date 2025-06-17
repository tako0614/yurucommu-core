#!/usr/bin/env deno run --allow-all

/**
 * Takopack Builder API v2.0
 *
 * takopack仕様に準拠した拡張機能のビルドツール
 * 関数ベース開発とesbuildバンドルをサポート
 */

import {
  dirname,
  join,
  resolve,
  toFileUrl,
} from "https://deno.land/std@0.208.0/path/mod.ts";
import { existsSync } from "https://deno.land/std@0.208.0/fs/mod.ts";
import { BlobWriter, TextReader, ZipWriter } from "@zip-js/zip-js";
import * as esbuild from "esbuild";
import type { ExtensionManifest } from "./types/takos-api.ts";
import { denoPlugins } from "jsr:@luca/esbuild-deno-loader@^0.11.1";
// Permission types based on the specification
export type Permission =
  | "fetch:net"
  | "activitypub:send"
  | "activitypub:read"
  | "activitypub:receive:hook"
  | "activitypub:actor:read"
  | "activitypub:actor:write"
  | "plugin-actor:create"
  | "plugin-actor:read"
  | "plugin-actor:write"
  | "plugin-actor:delete"
  | "kv:read"
  | "kv:write"
  | "cdn:read"
  | "cdn:write"
  | "events:publish"
  | "deno:read"
  | "deno:write"
  | "deno:net"
  | "deno:env"
  | "deno:run"
  | "deno:sys"
  | "deno:ffi"
  | "extensions:invoke"
  | "extensions:export";

// Function types
export type ServerFunction<
  TArgs extends unknown[] = unknown[],
  TReturn = unknown,
> = (...args: TArgs) => TReturn | Promise<TReturn>;
export type ClientFunction<TArgs extends unknown[] = unknown[]> = (
  ...args: TArgs
) => void | Promise<void>;
export type EventHandlerFunction<T = unknown> = (
  payload: T,
) => [number, unknown] | Promise<[number, unknown]>;
export type ClientEventHandlerFunction<T = unknown> = (
  payload: T,
) => void | Promise<void>;
export type UIEventHandlerFunction<T = unknown> = (
  payload: T,
) => void | Promise<void>;

// ActivityPub types
export type ActivityPubCanAcceptFunction<T = unknown> = (
  context: string,
  object: T,
) => boolean | Promise<boolean>;
export type ActivityPubHookFunction<T = unknown> = (
  context: string,
  object: T,
) => unknown | Promise<unknown>;

// Build interfaces
export interface BuildMetrics {
  buildStartTime: number;
  buildEndTime: number;
  totalDuration: number;
  bundlingDuration: number;
  validationDuration: number;
  compressionDuration: number;
  outputSize: {
    server: number;
    client: number;
    ui: number;
    total: number;
  };
  functionCounts: {
    server: number;
    client: number;
    events: number;
  };
  warnings: string[];
  errors: string[];
}

export interface BundleOptions {
  /** Target JavaScript version (default: "es2020") */
  target?: string;
  /** Development mode with source maps and readable output (disables minification) */
  development?: boolean;
  /** Enable detailed build analytics */
  analytics?: boolean;
  /** Enable strict validation checks */
  strictValidation?: boolean;
}

// 新しいイベント定義フォーマット
export interface EventDefinition {
  source: "client" | "server" | "background" | "ui";
  target: "server" | "client" | "client:*" | "ui" | "background";
  handler: string;
}

// ActivityPub設定（新しい単一API形式）
export interface ActivityPubConfig {
  context: string;
  object: string;
  canAccept?: string;
  hook?: string;
  priority?: number;
  serial?: boolean;
}

// マニフェスト設定
export interface ManifestConfig {
  name: string;
  description: string;
  version: string;
  identifier: string;
  apiVersion?: string;
  permissions?: Permission[]; // 一括で記述
  eventDefinitions?: Record<string, EventDefinition>;
  activityPub?: ActivityPubConfig[]; // 新しい単一API形式
}

// 関数登録インターフェース
export interface ServerFunctionRegistration {
  name: string;
  fn: ServerFunction<unknown[], unknown>;
  type?: "hook" | "event" | "general";
}

export interface ClientFunctionRegistration {
  name: string;
  fn: ClientFunction<unknown[]>;
  type?: "event" | "general";
}

/**
 * 改訂版 Function-based Takopack Builder
 */
export default class FunctionBasedTakopack {
  private outputDir = "dist";
  private packageName = "extension";
  private serverFunctions = new Map<string, ServerFunctionRegistration>();
  private clientFunctions = new Map<string, ClientFunctionRegistration>();
  private manifestConfig?: ManifestConfig;
  private uiHTML?: string;
  private bundleOptions: BundleOptions = {
    target: "es2020",
    development: false,
    analytics: false,
    strictValidation: true,
  };

  /**
   * Set output directory
   */
  output(dir: string): this {
    this.outputDir = dir;
    return this;
  }

  /**
   * Set package name
   */
  package(name: string): this {
    this.packageName = name;
    return this;
  }

  /**
   * Configure bundle options
   */
  bundle(options: BundleOptions): this {
    this.bundleOptions = { ...this.bundleOptions, ...options };
    return this;
  }
  /**
   * Configure manifest
   */
  config(config: ManifestConfig): this {
    this.manifestConfig = { ...this.manifestConfig, ...config };
    return this;
  }

  /**
   * Set UI HTML content
   */
  ui(htmlContent: string): this {
    this.uiHTML = htmlContent;
    return this;
  }

  /**
   * Register a server function
   */
  serverFunction<TArgs extends unknown[], TReturn>(
    name: string,
    fn: (...args: TArgs) => TReturn | Promise<TReturn>,
  ): this {
    this.serverFunctions.set(name, {
      name,
      fn: fn as ServerFunction<unknown[], unknown>,
      type: "general",
    });
    return this;
  }

  /**
   * Register a client function
   */
  clientFunction<TArgs extends unknown[]>(
    name: string,
    fn: (...args: TArgs) => void | Promise<void>,
  ): this {
    this.clientFunctions.set(name, {
      name,
      fn: fn as ClientFunction<unknown[]>,
      type: "general",
    });
    return this;
  }

  /**
   * 新しい ActivityPub API (単一のメソッド)
   * @param config - { context: string, object: string }を含む設定
   * @param canAccept - canAccept関数 (第2引数)
   * @param hook - hook関数 (第3引数)
   */
  activityPub<T>(
    config: {
      context: string;
      object: string;
      priority?: number;
      serial?: boolean;
    },
    canAccept?: ActivityPubCanAcceptFunction<T>,
    hook?: ActivityPubHookFunction<T>,
  ): this {
    // canAccept関数を登録
    if (canAccept) {
      const canAcceptName = `canAccept_${config.object.toLowerCase()}`;
      this.serverFunctions.set(canAcceptName, {
        name: canAcceptName,
        fn: canAccept as ServerFunction<unknown[], unknown>,
        type: "hook",
      });
    }

    // hook関数を登録
    if (hook) {
      const hookName = `hook_${config.object.toLowerCase()}`;
      this.serverFunctions.set(hookName, {
        name: hookName,
        fn: hook as ServerFunction<unknown[], unknown>,
        type: "hook",
      });
    }

    // ActivityPub設定をマニフェストに追加
    if (!this.manifestConfig) {
      this.manifestConfig = {
        name: "",
        description: "",
        version: "1.0.0",
        identifier: "",
        activityPub: [],
      };
    }
    if (!this.manifestConfig.activityPub) {
      this.manifestConfig.activityPub = [];
    }

    this.manifestConfig.activityPub.push({
      context: config.context,
      object: config.object,
      canAccept: canAccept
        ? `canAccept_${config.object.toLowerCase()}`
        : undefined,
      hook: hook ? `hook_${config.object.toLowerCase()}` : undefined,
      priority: config.priority,
      serial: config.serial,
    });

    return this;
  }
  /**
   * 新しいイベント定義方式
   */
  addEvent<T = unknown>(
    eventName: string,
    definition: EventDefinition,
    handler:
      | EventHandlerFunction<T>
      | ClientEventHandlerFunction<T>
      | UIEventHandlerFunction<T>,
  ): this {
    // ハンドラーを適切な場所に登録
    if (definition.target === "server") {
      this.serverFunctions.set(definition.handler, {
        name: definition.handler,
        fn: handler as ServerFunction<unknown[], unknown>,
        type: "event",
      });
    } else {
      this.clientFunctions.set(definition.handler, {
        name: definition.handler,
        fn: handler as ClientFunction<unknown[]>,
        type: "event",
      });
    }

    // イベント定義をマニフェストに追加
    if (!this.manifestConfig) {
      this.manifestConfig = {
        name: "",
        description: "",
        version: "1.0.0",
        identifier: "",
        eventDefinitions: {},
      };
    }
    if (!this.manifestConfig.eventDefinitions) {
      this.manifestConfig.eventDefinitions = {};
    }

    this.manifestConfig.eventDefinitions[eventName] = definition;

    return this;
  }

  /**
   * Client to Server event (convenience method)
   */
  addClientToServerEvent<T>(
    eventName: string,
    handler: EventHandlerFunction<T>,
  ): this {
    return this.addEvent(eventName, {
      source: "client",
      target: "server",
      handler: `on${eventName.charAt(0).toUpperCase()}${eventName.slice(1)}`,
    }, handler);
  }

  /**
   * Server to Client event (convenience method)
   */
  addServerToClientEvent<T>(
    eventName: string,
    handler: ClientEventHandlerFunction<T>,
  ): this {
    return this.addEvent(eventName, {
      source: "server",
      target: "client",
      handler: `on${eventName.charAt(0).toUpperCase()}${eventName.slice(1)}`,
    }, handler);
  }

  /**
   * Background to UI event (convenience method)
   */
  addBackgroundToUIEvent<T>(
    eventName: string,
    handler: UIEventHandlerFunction<T>,
  ): this {
    return this.addEvent(eventName, {
      source: "background",
      target: "ui",
      handler: `on${eventName.charAt(0).toUpperCase()}${eventName.slice(1)}`,
    }, handler);
  }

  /**
   * UI to Background event (convenience method)
   */
  addUIToBackgroundEvent<T>(
    eventName: string,
    handler: ClientEventHandlerFunction<T>,
  ): this {
    return this.addEvent(eventName, {
      source: "ui",
      target: "background",
      handler: `on${eventName.charAt(0).toUpperCase()}${eventName.slice(1)}`,
    }, handler);
  } /**
   * Generate server.js from registered functions
   */

  private generateServerJS(): string {
    const functions: string[] = [];
    const exports: string[] = [];
    const usedImports = new Set<string>();

    for (const [name, registration] of this.serverFunctions) {
      const fnString = registration.fn.toString();

      // Add type comment for event handlers
      const typeComment = registration.type === "event"
        ? `// @type event-handler\n// @returns [status: number, body: object]`
        : `// @type ${registration.type || "general"}`;
      // Handle arrow functions properly
      let functionDeclaration: string;
      if (fnString.includes("=>")) {
        // Arrow function - extract parameters and body
        const arrowIndex = fnString.indexOf("=>");
        let beforeArrow = fnString.substring(0, arrowIndex).trim();
        let body = fnString.substring(arrowIndex + 2).trim();

        // Handle async arrow functions
        const isAsync = beforeArrow.startsWith("async");
        if (isAsync) {
          beforeArrow = beforeArrow.substring(5).trim();
        }

        // Clean up parameter parentheses
        let cleanParams = beforeArrow;
        if (cleanParams.startsWith("(") && cleanParams.endsWith(")")) {
          cleanParams = cleanParams.slice(1, -1);
        }

        // Handle block vs expression body
        if (!body.startsWith("{")) {
          body = `{ return ${body}; }`;
        }

        const asyncKeyword = isAsync ? "async " : "";
        functionDeclaration =
          `${asyncKeyword}function ${name}(${cleanParams}) ${body}`;
      } else {
        // Regular function - handle anonymous functions
        if (fnString.startsWith("function")) {
          const parenIndex = fnString.indexOf("(");
          functionDeclaration = `function ${name}${
            fnString.substring(parenIndex)
          }`;
        } else if (fnString.startsWith("async function")) {
          const parenIndex = fnString.indexOf("(");
          functionDeclaration = `async function ${name}${
            fnString.substring(parenIndex)
          }`;
        } else {
          // Fallback: wrap as function
          functionDeclaration = `function ${name}() { return (${fnString}); }`;
        }
      }

      functions.push(`${typeComment}
${functionDeclaration}`);

      exports.push(name);
    }

    const importsString = Array.from(usedImports).join("\n");
    const exportsString = exports.length > 0
      ? `export { ${exports.join(", ")} };`
      : "";

    return `${importsString ? importsString + "\n\n" : ""}${
      functions.join("\n\n")
    }

${exportsString}`;
  } /**
   * Generate client.js from registered functions
   */

  private generateClientJS(): string {
    const functions: string[] = [];
    const exports: string[] = [];
    const usedImports = new Set<string>();
    const eventMapEntries: string[] = [];

    for (const [name, registration] of this.clientFunctions) {
      const fnString = registration.fn.toString();
      // Add type comment
      const typeComment = registration.type === "event"
        ? `// @type event-handler`
        : `// @type ${registration.type || "general"}`;

      // Handle arrow functions properly (same logic as server)
      let functionDeclaration: string;
      if (fnString.includes("=>")) {
        // Arrow function - extract parameters and body
        const arrowIndex = fnString.indexOf("=>");
        let beforeArrow = fnString.substring(0, arrowIndex).trim();
        let body = fnString.substring(arrowIndex + 2).trim();

        // Handle async arrow functions
        const isAsync = beforeArrow.startsWith("async");
        if (isAsync) {
          beforeArrow = beforeArrow.substring(5).trim();
        }

        // Clean up parameter parentheses
        let cleanParams = beforeArrow;
        if (cleanParams.startsWith("(") && cleanParams.endsWith(")")) {
          cleanParams = cleanParams.slice(1, -1);
        }

        // Handle block vs expression body
        if (!body.startsWith("{")) {
          body = `{ return ${body}; }`;
        }

        const asyncKeyword = isAsync ? "async " : "";
        functionDeclaration =
          `${asyncKeyword}function ${name}(${cleanParams}) ${body}`;
      } else {
        // Regular function - handle anonymous functions
        if (fnString.startsWith("function")) {
          const parenIndex = fnString.indexOf("(");
          functionDeclaration = `function ${name}${
            fnString.substring(parenIndex)
          }`;
        } else if (fnString.startsWith("async function")) {
          const parenIndex = fnString.indexOf("(");
          functionDeclaration = `async function ${name}${
            fnString.substring(parenIndex)
          }`;
        } else {
          // Fallback: wrap as function
          functionDeclaration = `function ${name}() { return (${fnString}); }`;
        }
      }

      functions.push(`${typeComment}
${functionDeclaration}`);

      exports.push(name);
    }

    if (this.manifestConfig?.eventDefinitions) {
      for (const [ev, def] of Object.entries(this.manifestConfig.eventDefinitions)) {
        if (def.handler && this.clientFunctions.has(def.handler)) {
          eventMapEntries.push(`  "${ev}": ${def.handler},`);
        }
      }
    }

    const importsString = Array.from(usedImports).join("\n");
    const exportsString = exports.length > 0
      ? `export { ${exports.join(", ")} };`
      : "";

    const eventMap = eventMapEntries.length > 0
      ? `\nconst __events = {\n${eventMapEntries.join("\n")}\n};\nif(!globalThis.__takosClientEvents) globalThis.__takosClientEvents = {};\nglobalThis.__takosClientEvents["${this.manifestConfig?.identifier}"] = __events;\n`
      : "";

    return `${importsString ? importsString + "\n\n" : ""}${
      functions.join("\n\n")
    }
${eventMap}
${exportsString}`;
  }

  /**
   * takopack manifest.json 生成
   *
   * takopack仕様v2.0に準拠したmanifest.jsonを生成
   */
  private generateManifest(): ExtensionManifest {
    if (!this.manifestConfig) {
      throw new Error(
        "Manifest configuration is required. Call .config() to set manifest configuration.",
      );
    }

    // 基本的なmanifest構造（takopack仕様準拠）
    const manifest: ExtensionManifest = {
      name: this.manifestConfig.name,
      description: this.manifestConfig.description,
      version: this.manifestConfig.version,
      identifier: this.manifestConfig.identifier,
      apiVersion: this.manifestConfig.apiVersion || "2.0",
      permissions: this.manifestConfig.permissions || [],
      server: {
        entry: "./server.js",
      },
      client: {
        entryUI: "./index.html",
        entryBackground: "./client.js",
      },
    };

    // eventDefinitions の追加（takopack仕様のsource/target形式）
    if (
      this.manifestConfig.eventDefinitions &&
      Object.keys(this.manifestConfig.eventDefinitions).length > 0
    ) {
      manifest.eventDefinitions = this.manifestConfig.eventDefinitions;
    }

    // activityPub設定の追加（takopack仕様準拠）
    if (
      this.manifestConfig.activityPub &&
      this.manifestConfig.activityPub.length > 0
    ) {
      manifest.activityPub = {
        objects: this.manifestConfig.activityPub.map((config) => ({
          accepts: [config.object],
          context: config.context,
          hooks: {
            canAccept: config.canAccept,
            onReceive: config.hook,
            priority: config.priority || 0,
            serial: config.serial || false,
          },
        })),
      };
    }

    return manifest;
  }
  /**
   * Bundles a single file with esbuild
   */ private async bundleWithEsbuild(
    entryPoint: string,
    outputPath: string,
    platform: "node" | "browser",
  ): Promise<void> {
    try {
      // ★ Windows でも POSIX でも安全に解決できるよう file URL へ変換
      const absoluteEntry = resolve(entryPoint);
      const entryURL = toFileUrl(absoluteEntry).href;
      const result = await esbuild.build({
        absWorkingDir: dirname(absoluteEntry), // ← resolveDir 相当を明示
        entryPoints: [entryURL],
        outfile: outputPath,
        bundle: true,
        platform,
        format: "esm",
        target: this.bundleOptions.target || "es2020",
        minify: !this.bundleOptions.development,
        sourcemap: this.bundleOptions.development,
        treeShaking: true,
        metafile: this.bundleOptions.analytics,
        write: true,
        // deno-loaderプラグインを使用
        plugins: [...denoPlugins()],
      });

      if (this.bundleOptions.analytics && result.metafile) {
        console.log(
          "📊 Bundle analysis:",
          await esbuild.analyzeMetafile(result.metafile),
        );
      }
    } catch (error) {
      console.error(`❌ Bundling failed for ${outputPath}:`, error);
      throw error;
    }
  }

  /**
   * Build the extension
   */
  async build(): Promise<void> {
    const buildStartTime = performance.now();
    console.log(`🚀 Building takopack: ${this.packageName}...`);

    // Create output directory
    if (!existsSync(this.outputDir)) {
      await Deno.mkdir(this.outputDir, { recursive: true });
    }

    const outDir = resolve(this.outputDir);
    // sauceディレクトリを作成
    const sauceDir = join(outDir, "sauce");
    if (!existsSync(sauceDir)) {
      await Deno.mkdir(sauceDir, { recursive: true });
    }

    try {
      // 1. サーバーコード生成とバンドル
      if (this.serverFunctions.size > 0) {
        console.log("🔧 Generating server.js...");
        const tempServerFile = join(sauceDir, "_temp_server.ts");
        const serverCode = this.generateServerJS();
        await Deno.writeTextFile(tempServerFile, serverCode);

        try {
          await this.bundleWithEsbuild(
            tempServerFile,
            join(sauceDir, "server.js"),
            "node",
          );
          console.log("✅ Generated and bundled server.js");
        } finally {
          try {
            await Deno.remove(tempServerFile);
          } catch {
            // 一時ファイル削除エラーは無視
          }
        }
      }

      // 2. クライアントコード生成とバンドル
      if (this.clientFunctions.size > 0) {
        console.log("🔧 Generating client.js...");
        const tempClientFile = join(sauceDir, "_temp_client.ts");
        const clientCode = this.generateClientJS();
        await Deno.writeTextFile(tempClientFile, clientCode);

        try {
          await this.bundleWithEsbuild(
            tempClientFile,
            join(sauceDir, "client.js"),
            "browser",
          );
          console.log("✅ Generated and bundled client.js");
        } finally {
          try {
            await Deno.remove(tempClientFile);
          } catch {
            // 一時ファイル削除エラーは無視
          }
        }
      }

      // 3. UI HTML生成
      if (this.uiHTML) {
        await Deno.writeTextFile(join(sauceDir, "index.html"), this.uiHTML);
        console.log("✅ Generated index.html");
      }

      // 4. manifest.json生成（takopack仕様準拠）
      console.log("🔧 Generating manifest.json...");
      const manifest = this.generateManifest();
      await Deno.writeTextFile(
        join(sauceDir, "manifest.json"),
        JSON.stringify(manifest, null, 2),
      );
      console.log("✅ Generated manifest.json (takopack v2.0 format)");

      // 5. .takopackファイル作成（distディレクトリに出力）
      console.log("📦 Creating .takopack file...");
      await this.createTakopackFile(sauceDir, outDir);

      const buildEndTime = performance.now();
      const totalDuration = buildEndTime - buildStartTime;

      console.log(`🎉 Build completed in ${totalDuration.toFixed(2)}ms`);
      console.log(`📦 Package: ${join(outDir, this.packageName)}.takopack`);
      console.log(`📁 Output: ${outDir}`);
      console.log(`📁 Source files: ${sauceDir}`);

      // ビルド統計表示
      if (this.bundleOptions.analytics) {
        this.displayBuildMetrics(buildStartTime, buildEndTime);
      }
    } catch (error) {
      console.error("❌ Build failed:", error);
      throw error;
    }
  }

  /**
   * takopackファイル生成
   *
   * takopack仕様に準拠したzipファイルを生成:
   * - takos/ ディレクトリ構造
   * - manifest.json（必須）
   * - server.js, client.js, index.html
   *
   * @param sourceDir - ソースファイルがあるディレクトリ (dist/sauce)
   * @param outputDir - .takopackファイルの出力先ディレクトリ (dist)
   */
  private async createTakopackFile(
    sourceDir: string,
    outputDir: string,
  ): Promise<void> {
    const zipFile = new BlobWriter("application/zip");
    const zipWriter = new ZipWriter(zipFile);

    const addFileToZip = async (filePath: string, zipPath: string) => {
      try {
        const content = await Deno.readTextFile(filePath);
        await zipWriter.add(zipPath, new TextReader(content));
        console.log(`📁 Added ${zipPath} to takopack`);
      } catch (error) {
        console.warn(`⚠️ Could not add ${filePath} to zip:`, error);
      }
    };

    // takopack仕様: takos/ ディレクトリ下にファイルを配置
    const requiredFiles = ["manifest.json"];
    const optionalFiles = ["server.js", "client.js", "index.html"];

    // 必須ファイルの追加
    for (const file of requiredFiles) {
      const filePath = join(sourceDir, file);
      if (existsSync(filePath)) {
        await addFileToZip(filePath, `takos/${file}`);
      } else {
        throw new Error(`Required file ${file} is missing`);
      }
    }

    // オプションファイルの追加
    for (const file of optionalFiles) {
      const filePath = join(sourceDir, file);
      if (existsSync(filePath)) {
        await addFileToZip(filePath, `takos/${file}`);
      }
    }

    await zipWriter.close();

    // ZIP ファイルの書き込み（distディレクトリに出力）
    const zipBlob = await zipFile.getData();
    const arrayBuffer = await zipBlob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    const outputPath = join(outputDir, `${this.packageName}.takopack`);
    await Deno.writeFile(outputPath, uint8Array);

    console.log(`📦 Created ${outputPath}`);
  }

  /**
   * ビルド統計表示
   */
  private displayBuildMetrics(startTime: number, endTime: number): void {
    console.log("\n📊 Build Metrics:");
    console.log(
      `  ⏱️  Total build time: ${(endTime - startTime).toFixed(2)}ms`,
    );
    console.log(`  🔧 Server functions: ${this.serverFunctions.size}`);
    console.log(`  💻 Client functions: ${this.clientFunctions.size}`);
    console.log(
      `  📨 Event definitions: ${
        Object.keys(this.manifestConfig?.eventDefinitions || {}).length
      }`,
    );
    console.log(
      `  🌐 ActivityPub configs: ${
        this.manifestConfig?.activityPub?.length || 0
      }`,
    );
    console.log(
      `  🔐 Permissions: ${this.manifestConfig?.permissions?.length || 0}`,
    );

    if (this.bundleOptions.development) {
      console.log(`  🚧 Development mode: enabled (with source maps)`);
    } else {
      console.log(`  🚀 Production mode: enabled (minified)`);
    }
  }
}
