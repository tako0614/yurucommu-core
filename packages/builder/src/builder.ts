import { basename, join, resolve } from "jsr:@std/path@1";
import { existsSync } from "jsr:@std/fs@1";
import {
  BlobWriter,
  TextReader,
  Uint8ArrayReader,
  ZipWriter,
} from "jsr:@zip-js/zip-js@^2.7.62";
import * as esbuild from "npm:esbuild";
import { denoPlugins } from "jsr:@luca/esbuild-deno-loader@^0.11.1";

import type {
  ActivityPubConfig,
  BuildMetrics,
  BuildResult,
  EventDefinition,
  ExtensionManifest,
  ModuleAnalysis,
  TakopackConfig,
  TypeGenerationOptions,
  TypeGenerationResult,
  VirtualEntry,
} from "./types.ts";
import { ASTAnalyzer } from "./analyzer.ts";
import { VirtualEntryGenerator } from "./generator.ts";
import { defaultConfig } from "./config.ts";

/**
 * Takopack Builder 3.0 メインクラス
 *
 * toString依存をゼロにした新世代ビルドシステム
 * - AST解析による静的分析
 * - Virtual entrypoint生成
 * - esbuildによる最適化
 */
export class TakopackBuilder {
  private config: TakopackConfig;
  private analyzer = new ASTAnalyzer();
  private generator = new VirtualEntryGenerator();
  private tempDir = ".takopack-tmp";

  constructor(config: TakopackConfig) {
    this.config = { ...defaultConfig, ...config };

    // 設定の検証
    this.validateConfig();
  }

  /**
   * ビルドを実行
   */
  async build(): Promise<BuildResult> {
    const buildStartTime = performance.now();

    console.log(`🚀 Building Takopack 3.0: ${this.config.manifest.name}...`);

    try {
      // 1. テンポラリディレクトリ準備
      await this.prepareTempDir();

      // 2. エントリポイント解析
      const analyses = await this.analyzeEntries();

      // 3. Virtual entrypoint生成
      const virtualEntries = await this.generateVirtualEntries(analyses);

      // 4. esbuildでバンドル
      const bundleResult = await this.bundleWithEsbuild(virtualEntries);

      // 5. マニフェスト生成
      const manifest = this.generateManifest(analyses);

      // 6. UIファイルコピー
      await this.copyUIFiles();

      // 7. アイコンファイルコピー
      await this.copyIconFile();

      // 8. .takopackファイル生成
      await this.createTakopackFile();

      // 9. クリーンアップ
      await this.cleanup();

      const buildEndTime = performance.now();

      // 10. 結果レポート
      const metrics = this.buildMetrics(
        buildStartTime,
        buildEndTime,
        bundleResult,
      );
      this.displayBuildReport(metrics);

      return {
        success: true,
        manifest,
        files: bundleResult,
        metrics,
        errors: [],
        warnings: [],
      };
    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.message
        : String(error);
      console.error("❌ Build failed:", errorMessage);

      return {
        success: false,
        manifest: {} as ExtensionManifest,
        files: {},
        metrics: {} as BuildMetrics,
        errors: [errorMessage],
        warnings: [],
      };
    }
  }

  /**
   * 設定の検証
   */
  private validateConfig(): void {
    if (!this.config.manifest.name) {
      throw new Error("manifest.name is required");
    }
    if (!this.config.manifest.identifier) {
      throw new Error("manifest.identifier is required");
    }
    if (!this.config.manifest.version) {
      throw new Error("manifest.version is required");
    }
  }

  /**
   * テンポラリディレクトリ準備
   */
  private async prepareTempDir(): Promise<void> {
    if (existsSync(this.tempDir)) {
      await Deno.remove(this.tempDir, { recursive: true });
    }
    await Deno.mkdir(this.tempDir, { recursive: true });
  }

  /**
   * エントリポイントファイルを解析
   */
  private async analyzeEntries(): Promise<{
    server: ModuleAnalysis[];
    client: ModuleAnalysis[];
  }> {
    const serverAnalyses: ModuleAnalysis[] = [];
    const clientAnalyses: ModuleAnalysis[] = [];

    // サーバーエントリポイント解析
    if (this.config.entries.server) {
      for (const entryPath of this.config.entries.server) {
        if (!existsSync(entryPath)) {
          console.warn(`⚠️ Server entry not found: ${entryPath}`);
          continue;
        }

        const analysis = await this.analyzer.analyze(entryPath);
        serverAnalyses.push(analysis);
      }
    }

    // クライアントエントリポイント解析
    if (this.config.entries.client) {
      for (const entryPath of this.config.entries.client) {
        if (!existsSync(entryPath)) {
          console.warn(`⚠️ Client entry not found: ${entryPath}`);
          continue;
        }

        const analysis = await this.analyzer.analyze(entryPath);
        clientAnalyses.push(analysis);
      }
    }

    console.log(
      `📊 Analyzed ${serverAnalyses.length} server entries, ${clientAnalyses.length} client entries`,
    );

    return { server: serverAnalyses, client: clientAnalyses };
  }

  /**
   * Virtual entrypoint生成
   */
  private async generateVirtualEntries(analyses: {
    server: ModuleAnalysis[];
    client: ModuleAnalysis[];
  }): Promise<{
    server?: VirtualEntry;
    client?: VirtualEntry;
  }> {
    const result: { server?: VirtualEntry; client?: VirtualEntry } = {};

    // サーバーエントリ生成
    if (analyses.server.length > 0) {
      result.server = this.generator.generateServerEntry(analyses.server);

      // ファイルに書き出し
      const serverPath = join(this.tempDir, "_entry_server.ts");
      await Deno.writeTextFile(serverPath, result.server.content);
      console.log(`📝 Generated server virtual entry: ${serverPath}`);
    }

    // クライアントエントリ生成
    if (analyses.client.length > 0) {
      result.client = this.generator.generateClientEntry(analyses.client);

      // ファイルに書き出し
      const clientPath = join(this.tempDir, "_entry_client.ts");
      await Deno.writeTextFile(clientPath, result.client.content);
      console.log(`📝 Generated client virtual entry: ${clientPath}`);
    }

    return result;
  }

  /**
   * esbuildでバンドル
   */
  private async bundleWithEsbuild(virtualEntries: {
    server?: VirtualEntry;
    client?: VirtualEntry;
  }): Promise<{
    server?: string;
    client?: string;
  }> {
    const result: { server?: string; client?: string } = {};
    const outDir = this.config.build?.outDir || "dist";
    const sauceDir = join(outDir, "sauce");

    // sauceディレクトリ作成
    if (!existsSync(sauceDir)) {
      await Deno.mkdir(sauceDir, { recursive: true });
    }

    // サーバーバンドル
    if (virtualEntries.server) {
      console.log("🔧 Bundling server...");
      await this.bundleFile(
        join(this.tempDir, "_entry_server.ts"),
        join(sauceDir, "server.js"),
        "node",
      );
      result.server = join(sauceDir, "server.js");
    }

    // クライアントバンドル
    if (virtualEntries.client) {
      console.log("🔧 Bundling client...");
      await this.bundleFile(
        join(this.tempDir, "_entry_client.ts"),
        join(sauceDir, "client.js"),
        "browser",
      );
      result.client = join(sauceDir, "client.js");
    }

    return result;
  }
  /**
   * 単一ファイルをesbuildでバンドル
   */
  private async bundleFile(
    entryPoint: string,
    outputPath: string,
    platform: "node" | "browser",
  ): Promise<void> {
    try {
      const buildOptions: esbuild.BuildOptions = {
        entryPoints: [entryPoint],
        outfile: outputPath,
        bundle: true,
        format: "esm",
        platform: platform === "node" ? "node" : "browser",
        target: this.config.build?.target || "es2022",
        minify: !this.config.build?.dev && (this.config.build?.minify ?? true),
        sourcemap: this.config.build?.dev,
        treeShaking: true,
        mainFields: ["module", "main"],
        external: [
          // Keep only Node built-ins external so Deno can resolve bundled deps
          "node:*",
          "inspector",
        ],
        plugins: [
          ...denoPlugins({
            configPath: resolve("deno.json"),
          }),
        ],
      };

      const result = await esbuild.build(buildOptions);

      if (result.errors.length > 0) {
        throw new Error(
          `Build errors: ${result.errors.map((e) => e.text).join(", ")}`,
        );
      }

      console.log(`✅ Bundled: ${entryPoint} → ${outputPath}`);
    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.message
        : String(error);
      throw new Error(`Failed to bundle ${entryPoint}: ${errorMessage}`);
    }
  }

  /**
   * マニフェスト生成
   */
  private generateManifest(analyses: {
    server: ModuleAnalysis[];
    client: ModuleAnalysis[];
  }): ExtensionManifest {
    const manifest: ExtensionManifest = {
      name: this.config.manifest.name,
      description: this.config.manifest.description || "",
      version: this.config.manifest.version,
      identifier: this.config.manifest.identifier,
      icon: this.config.manifest.icon
        ? `./${basename(this.config.manifest.icon)}`
        : undefined,
      apiVersion: "3.0",
      permissions: this.config.manifest.permissions || [],
      extensionDependencies: this.config.manifest.extensionDependencies,
      exports: this.config.manifest.exports,
      server: {
        entry: "./server.js",
      },
      client: {
        entryUI: "./index.html",
        entryBackground: "./client.js",
      },
    };

    // イベント定義とActivityPub設定をAST解析結果から抽出
    const eventDefinitions: Record<string, EventDefinition> = {};
    const activityPubConfigs: ActivityPubConfig[] = [];

    const exportedClassSet = new Set<string>();

    [...analyses.server, ...analyses.client].forEach((analysis) => {
      analysis.exports.forEach((exp) => {
        if (exp.type === "class") exportedClassSet.add(exp.name);
      });
    });    // デバッグ用: AST解析結果を出力
    console.log("🔍 AST Analysis Debug:");
    [...analyses.server, ...analyses.client].forEach((analysis) => {
      console.log(`  File: ${analysis.filePath}`);
      console.log(`    JSDoc tags: ${analysis.jsDocTags.length}`);
      analysis.jsDocTags.forEach((tag) => {
        console.log(
          `      @${tag.tag}: ${tag.value} (target: ${tag.targetFunction})`,
        );
      });
      console.log(`    Decorators: ${analysis.decorators.length}`);
      analysis.decorators.forEach((decorator) => {
        console.log(
          `      @${decorator.name}(${
            JSON.stringify(decorator.args)
          }) (target: ${decorator.targetFunction})`,
        );
      });
      console.log(`    Exports: ${analysis.exports.length}`);
      analysis.exports.forEach((exp) => {
        console.log(
          `      export ${exp.type} ${exp.name} ${exp.instanceOf ? `(instanceOf: ${exp.instanceOf})` : ''}`,
        );
      });
      console.log(`    Method calls: ${analysis.methodCalls.length}`);
      analysis.methodCalls.forEach((call) => {
        console.log(
          `      ${call.objectName}.${call.methodName}(${call.args.join(', ')})`,
        );
      });    });

    // クラスベースのイベント定義のみをサポート（JSDoc/デコレータは廃止）
    const hasEventDefinitions = this.extractEventDefinitionsFromClasses(analyses, eventDefinitions);
    
    // イベント定義が必須
    if (!hasEventDefinitions) {
      throw new Error(
        `❌ No event definitions found. Event definitions using classes are required.\n\n` +
        `Please use class-based event definitions in your client/server files:\n\n` +
        `import { Takos } from "../../../../packages/builder/src/classes.ts";\n\n` +
        `export const takos = new Takos();\n\n` +
        `takos\n` +
        `  .client("eventName", handlerFunction)\n` +
        `  .server("serverEvent", serverHandler)\n` +
        `  .ui("uiEvent", uiHandler);\n\n` +
        `JSDoc-based event definitions (@event) and decorators are no longer supported.`
      );
    }

    // マニフェストに追加
    if (Object.keys(eventDefinitions).length > 0) {
      manifest.eventDefinitions = eventDefinitions;
    }
    if (activityPubConfigs.length > 0) {
      manifest.activityPub = {
        objects: activityPubConfigs.map((c) => c.object),
        hook: activityPubConfigs[0].hook,
      };
    }

    return manifest;
  }

  /**
   * UIファイルをコピー
   */
  private async copyUIFiles(): Promise<void> {
    const outDir = this.config.build?.outDir || "dist";
    const sauceDir = join(outDir, "sauce");

    if (this.config.entries.ui) {
      for (const uiPath of this.config.entries.ui) {
        if (existsSync(uiPath)) {
          const filename = uiPath.split("/").pop() || "index.html";
          const destPath = join(sauceDir, filename);
          await Deno.copyFile(uiPath, destPath);
          console.log(`📋 Copied UI: ${uiPath} → ${destPath}`);
        }
      }
    }
  }

  /**
   * アイコンファイルをコピー
   */
  private async copyIconFile(): Promise<void> {
    if (!this.config.manifest.icon) return;
    const outDir = this.config.build?.outDir || "dist";
    const sauceDir = join(outDir, "sauce");
    const iconPath = this.config.manifest.icon;
    if (existsSync(iconPath)) {
      const destPath = join(sauceDir, basename(iconPath));
      await Deno.copyFile(iconPath, destPath);
      console.log(`📋 Copied icon: ${iconPath} → ${destPath}`);
    }
  }

  /**
   * .takopackファイル生成
   */
  private async createTakopackFile(): Promise<void> {
    const outDir = this.config.build?.outDir || "dist";
    const sauceDir = join(outDir, "sauce");

    // マニフェスト保存
    const manifest = this.generateManifest(await this.analyzeEntries());
    await Deno.writeTextFile(
      join(sauceDir, "manifest.json"),
      JSON.stringify(manifest, null, 2),
    );

    // ZIP作成
    const zipFile = new BlobWriter("application/zip");
    const zipWriter = new ZipWriter(zipFile);

    const addFileToZip = async (
      filePath: string,
      zipPath: string,
      binary = false,
    ) => {
      if (existsSync(filePath)) {
        if (binary) {
          const buf = await Deno.readFile(filePath);
          await zipWriter.add(zipPath, new Uint8ArrayReader(buf));
        } else {
          const content = await Deno.readTextFile(filePath);
          await zipWriter.add(zipPath, new TextReader(content));
        }
      }
    };

    // takopack仕様: takos/ ディレクトリ下にファイルを配置
    const requiredFiles = ["manifest.json"];
    const optionalFiles = ["server.js", "client.js", "index.html"];
    let iconFile: string | undefined;
    if (this.config.manifest.icon) {
      iconFile = basename(this.config.manifest.icon);
      optionalFiles.push(iconFile);
    }

    // 必須ファイルの追加
    for (const file of requiredFiles) {
      await addFileToZip(join(sauceDir, file), `takos/${file}`);
    }

    // オプションファイルの追加
    for (const file of optionalFiles) {
      const filePath = join(sauceDir, file);
      if (existsSync(filePath)) {
        const isIcon = iconFile && file === iconFile;
        await addFileToZip(filePath, `takos/${file}`, Boolean(isIcon));
      }
    }

    await zipWriter.close();

    // ZIP ファイルの書き込み
    const zipBlob = await zipFile.getData();
    const arrayBuffer = await zipBlob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    const packageName = this.config.manifest.identifier.split(".").pop() ||
      "extension";
    const outputPath = join(outDir, `${packageName}.takopack`);
    await Deno.writeFile(outputPath, uint8Array);

    console.log(`📦 Created ${outputPath}`);
  }

  /**
   * クリーンアップ
   */
  private async cleanup(): Promise<void> {
    if (existsSync(this.tempDir)) {
      await Deno.remove(this.tempDir, { recursive: true });
    }
  }

  /**
   * ビルドメトリクス生成
   */
  private buildMetrics(
    startTime: number,
    endTime: number,
    bundleResult: { server?: string; client?: string },
  ): BuildMetrics {
    return {
      buildStartTime: startTime,
      buildEndTime: endTime,
      totalDuration: endTime - startTime,
      bundlingDuration: 0, // TODO: 個別計測
      validationDuration: 0,
      compressionDuration: 0,
      outputSize: {
        server: bundleResult.server ? this.getFileSize(bundleResult.server) : 0,
        client: bundleResult.client ? this.getFileSize(bundleResult.client) : 0,
        ui: 0, // TODO: UI計測
        total: 0,
      },
      functionCounts: {
        server: 0, // TODO: カウント
        client: 0,
        events: 0,
      },
      warnings: [],
      errors: [],
    };
  }

  /**
   * ビルドレポート表示
   */
  private displayBuildReport(metrics: BuildMetrics): void {
    console.log("\n📊 Build Report:");
    console.log(
      `  ⏱️  Total build time: ${metrics.totalDuration.toFixed(2)}ms`,
    );
    console.log(
      `  📦 Package: ${this.config.manifest.name} v${this.config.manifest.version}`,
    );
    console.log(
      `  🔐 Permissions: ${this.config.manifest.permissions?.length || 0}`,
    );

    if (this.config.build?.dev) {
      console.log("  🚧 Development mode enabled");
    } else {
      console.log("  🚀 Production build completed");
    }
  }

  /**
   * ファイルサイズ取得
   */
  private getFileSize(filePath: string): number {
    try {
      const stat = Deno.statSync(filePath);
      return stat.size;
    } catch {
      return 0;
    }
  } /**
   * JSDocタグからイベント名を抽出
   */  private extractEventNameFromTag(value: string): string | null {
    console.log(`[DEBUG] extractEventNameFromTag - value: "${value}"`);
    
    // まず複雑な形式 "("eventName", { ... })" を試す
    const match = value.match(/^\("([^"']+)"/);
    console.log(`[DEBUG] extractEventNameFromTag - complex match: ${match}`);
    
    if (match) {
      const result = match[1];
      console.log(`[DEBUG] extractEventNameFromTag - complex result: ${result}`);
      return result;
    }
    
    // シンプルな形式 " eventName" を試す
    const simpleMatch = value.trim();
    console.log(`[DEBUG] extractEventNameFromTag - simple match: "${simpleMatch}"`);
    
    if (simpleMatch && !simpleMatch.includes("(") && !simpleMatch.includes("{")) {
      console.log(`[DEBUG] extractEventNameFromTag - simple result: ${simpleMatch}`);
      return simpleMatch;
    }
    
    console.log(`[DEBUG] extractEventNameFromTag - no match found`);
    return null;
  }/**
   * イベント設定をパース
   */
  private parseEventConfig(
    value: string,
    targetFunction: string,
  ): EventDefinition | null {
    try {
      console.log(
        `[DEBUG] parseEventConfig - value: "${value}", targetFunction: "${targetFunction}"`,
      );
      
      // まず複雑な形式 "("eventName", { ... })" を試す
      const complexMatch = value.match(/^\("([^"']+)"(?:,\s*({.+}))?/);
      console.log(`[DEBUG] parseEventConfig - complex match: ${complexMatch}`);
      
      if (complexMatch) {
        let options: Record<string, unknown> = {};
        if (complexMatch[2]) {
          try {
            // JavaScriptオブジェクトリテラルをJSONに変換
            const jsObjectString = complexMatch[2];
            const jsonString = jsObjectString.replace(/(\w+):/g, '"$1":');
            console.log(`[DEBUG] parseEventConfig - jsonString: ${jsonString}`);
            options = JSON.parse(jsonString);
          } catch (jsonError) {
            console.log(
              `[DEBUG] parseEventConfig - JSON parse error: ${jsonError}`,
            );
            // eval を使って JavaScript オブジェクトリテラルを評価
            options = eval("(" + complexMatch[2] + ")");
          }
        }
        console.log(
          `[DEBUG] parseEventConfig - options: ${JSON.stringify(options)}`,
        );

        const result = {
          source: (options.source as "client" | "server" | "background" | "ui") ||
            "client",
          handler: targetFunction,
        };
        console.log(
          `[DEBUG] parseEventConfig - complex result: ${JSON.stringify(result)}`,
        );
        return result;
      }
      
      // シンプルな形式 " eventName" の場合はデフォルト設定を使用
      const simpleValue = value.trim();
      if (simpleValue && !simpleValue.includes("(") && !simpleValue.includes("{")) {
        const result = {
          source: "client" as const,
          handler: targetFunction,
        };
        console.log(
          `[DEBUG] parseEventConfig - simple result: ${JSON.stringify(result)}`,
        );
        return result;
      }
        console.log(`[DEBUG] parseEventConfig - no match found`);
      return null;
    } catch (error) {
      console.log(`[DEBUG] parseEventConfig - error: ${error}`);
      return null;
    }
  }

  /**
  /**
   * ActivityPub設定をパース
   */
  private parseActivityConfig(
    value: string,
    targetFunction: string,
  ): ActivityPubConfig | null {
    try {
      const match = value.match(/^["']([^"']+)["'](?:,\s*({.+}))?/);
      if (!match) return null;

      const object = match[1];
      return {
        object,
        hook: targetFunction,
      };
    } catch {
      return null;
    }
  }
  /**
   * TypeScript型定義ファイルを生成
   */
  async generateTypeDefinitions(
    options: TypeGenerationOptions,
  ): Promise<TypeGenerationResult> {
    console.log(
      `🔧 Generating TypeScript definitions for ${options.context} context...`,
    );

    try {
      // 型定義を生成
      const result = this.generator.generateTypeDefinitions(options);

      // ファイルに書き出し
      const encoder = new TextEncoder();
      const data = encoder.encode(result.content);
      await Deno.writeFile(result.filePath, data);

      console.log(
        `✅ Generated ${result.typeCount} types to ${result.filePath}`,
      );

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.message
        : String(error);
      console.error("❌ Type definition generation failed:", errorMessage);
      throw error;
    }
  }

  /**
   * 全コンテキストの型定義を生成
   */
  async generateAllTypeDefinitions(
    outputDir = "./types",
  ): Promise<TypeGenerationResult[]> {
    console.log("🔧 Generating TypeScript definitions for all contexts...");

    // 出力ディレクトリを作成
    try {
      await Deno.mkdir(outputDir, { recursive: true });
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) {
        throw error;
      }
    }

    const contexts: Array<"server" | "client" | "ui"> = [
      "server",
      "client",
      "ui",
    ];
    const results: TypeGenerationResult[] = [];

    for (const context of contexts) {
      const options: TypeGenerationOptions = {
        context,
        outputPath: `${outputDir}/takos-${context}.d.ts`,
        includeCustomTypes: true,
      };

      const result = await this.generateTypeDefinitions(options);
      results.push(result);
    }

    // 統合型定義ファイルも生成
    await this.generateUnifiedTypeDefinitions(outputDir, results);

    console.log(
      `✅ Generated type definitions for all contexts in ${outputDir}/`,
    );
    return results;
  }

  /**
   * 統合型定義ファイルを生成
   */ private async generateUnifiedTypeDefinitions(
    outputDir: string,
    _results: TypeGenerationResult[],
  ): Promise<void> {
    const lines: string[] = [];

    lines.push("// Unified TypeScript definitions for Takos Extension");
    lines.push("// This file exports all context-specific types");
    lines.push("// Generated at: " + new Date().toISOString());
    lines.push("");

    // 各コンテキストの型定義をエクスポート
    lines.push("// Export context-specific types");
    lines.push("export * from './takos-server.d.ts';");
    lines.push("export * from './takos-client.d.ts';");
    lines.push("export * from './takos-ui.d.ts';");
    lines.push("");

    // 型選択ヘルパー
    lines.push("// Type selection helpers");
    lines.push(
      "export type TakosContextAPI<T extends 'server' | 'client' | 'ui'> = ",
    );
    lines.push("  T extends 'server' ? typeof globalThis.takos :");
    lines.push("  T extends 'client' ? GlobalThisWithClientTakos['takos'] :");
    lines.push("  T extends 'ui' ? GlobalThisWithUITakos['takos'] :");
    lines.push("  never;");
    lines.push("");

    const content = lines.join("\n");
    const filePath = `${outputDir}/index.d.ts`;

    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    await Deno.writeFile(filePath, data);

    console.log(`📋 Generated unified type definitions: ${filePath}`);
  }

  /**
   * Takopack拡張クラスかどうかを判定
   */
  private isTakopackExtensionClass(className: string): boolean {
    const takopackClasses = [
      "Takos",
      "TakopackExtension", 
      "ServerExtension",
      "ClientExtension",
      "UIExtension"
    ];
    return takopackClasses.includes(className);
  }

  /**
   * クラスインスタンスからイベント定義を抽出
   */
  private extractEventDefinitionsFromClasses(
    analyses: { server: ModuleAnalysis[]; client: ModuleAnalysis[] },
    eventDefinitions: Record<string, EventDefinition>
  ): boolean {
    let hasDefinitions = false;
    
    [...analyses.server, ...analyses.client].forEach((analysis) => {
      analysis.exports.forEach((exp) => {
        if (exp.instanceOf && this.isTakopackExtensionClass(exp.instanceOf)) {
          console.log(`✅ Found Takopack extension instance: ${exp.name} (${exp.instanceOf})`);
          
          // このインスタンスのメソッド呼び出しを探す
          analysis.methodCalls.forEach((call) => {
            if (call.objectName === exp.name) {
              console.log(`🔧 Processing method call: ${call.objectName}.${call.methodName}(${call.args.join(', ')})`);
              
              // server, client, ui, background メソッドかどうかチェック
              if (['server', 'client', 'ui', 'background'].includes(call.methodName)) {
                const eventName = call.args[0] as string;
                const handlerArg = call.args[1];
                let handlerName = '';
                
                if (typeof handlerArg === 'string') {
                  // 関数名が文字列で渡された場合
                  handlerName = handlerArg;
                } else {
                  // 関数オブジェクトが渡された場合、その関数名を推測
                  handlerName = 'anonymous';
                }
                
                if (eventName) {
                  eventDefinitions[eventName] = {
                    source: call.methodName as "client" | "server" | "background" | "ui",
                    handler: handlerName,
                  };
                  console.log(`✅ Registered event: ${eventName} -> ${handlerName} (${call.methodName})`);
                  hasDefinitions = true;
                }
              }
            }
          });
        }
      });
    });
    
    return hasDefinitions;
  }
}
