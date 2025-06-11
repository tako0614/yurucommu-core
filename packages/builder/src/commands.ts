import type {
  BuildResult,
  TakopackConfig,
  TypeGenerationOptions,
  TypeGenerationResult,
} from "./types.ts";
import { TakopackBuilder } from "./builder.ts";

/**
 * ビルドコマンド
 */
export async function build(config: TakopackConfig): Promise<BuildResult> {
  const builder = new TakopackBuilder(config);
  return await builder.build();
}

/**
 * 監視モード（ファイル変更時に自動ビルド）
 */
export async function watch(config: TakopackConfig): Promise<void> {
  console.log("👀 Watching files for changes...");

  // 最初のビルド
  await build(config);

  // ファイル監視設定
  const watchPaths = [
    ...(config.entries.server || []),
    ...(config.entries.client || []),
    ...(config.entries.ui || []),
  ];

  if (watchPaths.length === 0) {
    console.warn("⚠️  No files to watch");
    return;
  }

  const watcher = Deno.watchFs(watchPaths);

  let isBuilding = false;
  let pendingRebuild = false;

  for await (const event of watcher) {
    if (
      event.kind === "modify" || event.kind === "create" ||
      event.kind === "remove"
    ) {
      if (isBuilding) {
        pendingRebuild = true;
        continue;
      }

      console.log(`\n🔄 File changed: ${event.paths.join(", ")}`);
      console.log("📦 Rebuilding...");

      isBuilding = true;
      try {
        await build(config);
        console.log("✅ Rebuild completed");
      } catch (error) {
        if (error instanceof Error) {
          console.error("❌ Rebuild failed:", error.message);
        } else {
          console.error("❌ Rebuild failed:", String(error));
        }
      } finally {
        isBuilding = false;

        if (pendingRebuild) {
          pendingRebuild = false;
          // 少し待ってから再ビルド
          setTimeout(async () => {
            if (!isBuilding) {
              console.log("🔄 Pending rebuild...");
              await build(config).catch(console.error);
            }
          }, 500);
        }
      }
    }
  }
}

/**
 * 開発モード（dev設定でビルド + 監視）
 */
export async function dev(config: TakopackConfig): Promise<void> {
  const devConfig: TakopackConfig = {
    ...config,
    build: {
      ...config.build,
      dev: true,
      minify: false,
    },
  };

  console.log("🚧 Development mode");
  await watch(devConfig);
}

/**
 * 新しいプロジェクトの初期化
 */
export async function init(projectName: string): Promise<void> {
  console.log(`🎯 Initializing new Takopack project: ${projectName}`);

  // プロジェクトディレクトリ作成
  if (!await exists(projectName)) {
    await Deno.mkdir(projectName, { recursive: true });
  }

  // サブディレクトリ作成
  const dirs = ["src/server", "src/client", "src/ui"];
  for (const dir of dirs) {
    await Deno.mkdir(`${projectName}/${dir}`, { recursive: true });
  }

  // 設定ファイル生成
  const configContent = `import { defineConfig } from "@takopack/builder";

export default defineConfig({
  manifest: {
    name: "${projectName}",
    identifier: "com.example.${projectName.toLowerCase()}",
    version: "1.0.0",
    description: "A Takopack extension",
    permissions: ["kv:read", "kv:write"],
  },

  entries: {
    server: ["src/server/hello.ts"],
    client: ["src/client/greet.ts"],
    ui: ["src/ui/index.html"],
  },

  build: {
    target: "es2022",
    dev: false,
    analysis: true,
  },
});`;

  await Deno.writeTextFile(`${projectName}/takopack.config.ts`, configContent);

  // サンプルファイル生成
  const serverContent = `// Server-side function
export function hello(name: string): string {
  return \`Hello, \${name} from server!\`;
}

/** @activity("Note", { priority: 100 }) */
export function onReceiveNote(ctx: string, note: any) {
  console.log("Received note:", note);
  return { status: "processed" };
}

export const canAcceptNote = (ctx: string, obj: any) => true;`;

  const clientContent = `// Client-side function
export function greet(): void {
  console.log("Hello from client background!");
}

/** @event("userClick", { source: "ui" }) */
export function onUserClick(data: any): void {
  console.log("User clicked:", data);
}`;

  const uiContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${projectName}</title>
    <style>
        body { font-family: Arial, sans-serif; padding: 20px; }
        .container { max-width: 600px; margin: 0 auto; }
        button { background: #007acc; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; }
        button:hover { background: #005a99; }
    </style>
</head>
<body>
    <div class="container">
        <h1>${projectName}</h1>
        <p>Welcome to your new Takopack extension!</p>
        <button onclick="handleClick()">Click me</button>
    </div>
    
    <script>
        function handleClick() {
            if (typeof takos !== 'undefined') {
                takos.events.publish('userClick', { timestamp: Date.now() });
            } else {
                console.log('Takos API not available');
            }
        }
    </script>
</body>
</html>`;

  await Deno.writeTextFile(`${projectName}/src/server/hello.ts`, serverContent);
  await Deno.writeTextFile(`${projectName}/src/client/greet.ts`, clientContent);
  await Deno.writeTextFile(`${projectName}/src/ui/index.html`, uiContent);

  // README.md生成
  const readmeContent = `# ${projectName}

A Takopack extension built with Takopack Builder 3.0.

## Development

\`\`\`bash
# Build the extension
deno run -A https://deno.land/x/takopack/cli.ts build

# Development mode (watch for changes)
deno run -A https://deno.land/x/takopack/cli.ts dev

# Build for production
deno run -A https://deno.land/x/takopack/cli.ts build --prod
\`\`\`

## Project Structure

- \`src/server/\` - Server-side logic (Node/Deno runtime)
- \`src/client/\` - Client background scripts
- \`src/ui/\` - UI files (HTML/CSS/JS)
- \`takopack.config.ts\` - Build configuration

## Features

- ✨ Static import preservation
- 🔍 AST-based function extraction
- 📦 Virtual entrypoint generation
- 🚀 esbuild optimization
- 🔧 Hot reload in development
`;

  await Deno.writeTextFile(`${projectName}/README.md`, readmeContent);

  console.log(`✅ Project initialized successfully!`);
  console.log(`\nNext steps:`);
  console.log(`  cd ${projectName}`);
  console.log(`  deno run -A https://deno.land/x/takopack/cli.ts dev`);
}

/**
 * 型定義生成コマンド
 */
export async function generateTypes(config: TakopackConfig, options?: {
  context?: "server" | "client" | "ui" | "all";
  outputDir?: string;
  includeCustomTypes?: boolean;
}): Promise<TypeGenerationResult[]> {
  console.log("🔧 Generating TypeScript definitions...");

  const builder = new TakopackBuilder(config);

  if (options?.context === "all" || !options?.context) {
    // 全コンテキストの型定義を生成
    return await builder.generateAllTypeDefinitions(options?.outputDir);
  } else {
    // 指定されたコンテキストの型定義を生成
    const typeOptions: TypeGenerationOptions = {
      context: options.context,
      outputPath: `${
        options?.outputDir || "./types"
      }/takos-${options.context}.d.ts`,
      includeCustomTypes: options?.includeCustomTypes ?? true,
    };

    const result = await builder.generateTypeDefinitions(typeOptions);
    return [result];
  }
}

// Utility function
async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}
