import { parseArgs } from "https://deno.land/std@0.208.0/cli/parse_args.ts";
import { resolve } from "https://deno.land/std@0.208.0/path/mod.ts";
import { existsSync } from "https://deno.land/std@0.208.0/fs/mod.ts";

import type { TakopackConfig, CommandArgs } from "./types.ts";
import { build, watch, dev, init, generateTypes } from "./commands.ts";

/**
 * CLI インターフェース
 */
export function createCLI() {
  return {
    async run(args: string[] = Deno.args): Promise<void> {      const parsed = parseArgs(args, {
        string: ["config", "out-dir", "context"],
        boolean: ["dev", "verbose", "help", "version", "include-custom"],
        alias: {
          c: "config",
          o: "out-dir", 
          d: "dev",
          v: "verbose",
          h: "help",
          x: "context",
        },
        default: {
          config: "takopack.config.ts",
          "out-dir": "dist",
          dev: false,
          verbose: false,
          context: "all",
          "include-custom": true,
        },
      });

      const command = parsed._[0] as string;
      
      // ヘルプ表示
      if (parsed.help || command === "help") {
        this.showHelp();
        return;
      }
      
      // バージョン表示
      if (parsed.version || command === "version") {
        this.showVersion();
        return;
      }

      // コマンド実行
      try {        await this.executeCommand({
          command: command as CommandArgs["command"],
          config: parsed.config,
          outDir: parsed["out-dir"],
          dev: parsed.dev,
          verbose: parsed.verbose,
          context: parsed.context as 'server' | 'client' | 'ui' | 'all',
          includeCustomTypes: parsed["include-custom"],
        });
      } catch (error) {
        console.error(`❌ ${error instanceof Error ? error.message : 'Unknown error'}`);
        Deno.exit(1);
      }
    },

    async executeCommand(args: CommandArgs): Promise<void> {
      switch (args.command) {
        case "build":
          await this.handleBuild(args);
          break;
        case "watch":
          await this.handleWatch(args);
          break;
        case "dev":
          await this.handleDev(args);
          break;        case "init":
          await this.handleInit(args);
          break;
        case "types":
          await this.handleTypes(args);
          break;
        default:
          console.error(`Unknown command: ${args.command}`);
          this.showHelp();
          Deno.exit(1);
      }
    },

    async handleBuild(args: CommandArgs): Promise<void> {
      const config = await this.loadConfig(args.config);
      
      // CLI引数でオーバーライド
      if (args.outDir) {
        config.build = { ...config.build, outDir: args.outDir };
      }
      if (args.dev) {
        config.build = { ...config.build, dev: true, minify: false };
      }

      const result = await build(config);
      
      if (!result.success) {
        console.error("❌ Build failed");
        result.errors.forEach(error => console.error(`  ${error}`));
        Deno.exit(1);
      }
    },

    async handleWatch(args: CommandArgs): Promise<void> {
      const config = await this.loadConfig(args.config);
      
      if (args.outDir) {
        config.build = { ...config.build, outDir: args.outDir };
      }

      await watch(config);
    },

    async handleDev(args: CommandArgs): Promise<void> {
      const config = await this.loadConfig(args.config);
      
      if (args.outDir) {
        config.build = { ...config.build, outDir: args.outDir };
      }

      await dev(config);
    },    async handleInit(_args: CommandArgs): Promise<void> {
      const projectName = Deno.args[1] || "my-extension";
      await init(projectName);
    },

    async handleTypes(args: CommandArgs): Promise<void> {
      const config = await this.loadConfig(args.config);
      
      const options = {
        context: args.context || 'all' as 'server' | 'client' | 'ui' | 'all',
        outputDir: args.outDir || './types',
        includeCustomTypes: args.includeCustomTypes ?? true,
      };

      const results = await generateTypes(config, options);
      
      console.log(`✅ Generated ${results.length} type definition file(s)`);
      results.forEach(result => {
        console.log(`  📝 ${result.filePath} (${result.typeCount} types)`);
      });
    },

    async loadConfig(configPath?: string): Promise<TakopackConfig> {
      const configFile = configPath || "takopack.config.ts";
      const resolvedPath = resolve(configFile);
      
      if (!existsSync(resolvedPath)) {
        throw new Error(`Config file not found: ${resolvedPath}`);
      }

      try {
        // 動的インポート
        const configModule = await import(`file://${resolvedPath}`);
        const config = configModule.default as TakopackConfig;
        
        if (!config) {
          throw new Error("Config file must export default configuration");
        }

        return config;
      } catch (error) {
        throw new Error(`Failed to load config: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    },

    showHelp(): void {
      console.log(`
🐙 Takopack Builder 3.0 - Next Generation Extension Build Tool

USAGE:
    takopack <COMMAND> [OPTIONS]

COMMANDS:
    build       Build the extension
    watch       Watch files and rebuild on changes  
    dev         Development mode (watch + dev settings)
    init        Initialize a new project
    types       Generate TypeScript type definitions
    help        Show this help message
    version     Show version information

OPTIONS:
    -c, --config <FILE>     Configuration file [default: takopack.config.ts]
    -o, --out-dir <DIR>     Output directory [default: dist]
    -d, --dev               Development mode
    -v, --verbose           Verbose output
    -h, --help              Show help
    -x, --context <CTX>     Type generation context: server|client|ui|all [default: all]
    --include-custom        Include custom project types [default: true]

EXAMPLES:
    takopack build                     # Build using takopack.config.ts
    takopack build -c my.config.ts     # Build with custom config
    takopack dev                       # Start development mode
    takopack init my-extension         # Create new project
    takopack watch --out-dir build     # Watch mode with custom output
    takopack types                     # Generate all type definitions
    takopack types -x server           # Generate server-only types
    takopack types -o ./src/types      # Generate types to custom directory

For more information, visit: https://github.com/takos/takopack
`);
    },

    showVersion(): void {
      console.log("Takopack Builder 3.0.0");
    },
  };
}

/**
 * CLI エントリポイント（スタンドアローン実行用）
 */
export async function main(): Promise<void> {
  const cli = createCLI();
  await cli.run();
}

// メイン実行（このファイルが直接実行された場合）
if (import.meta.main) {
  main();
}
