// 環境変数ファイルのパスを取得するユーティリティ
export function getEnvPath(): string | undefined {
  for (let i = 0; i < Deno.args.length; i++) {
    const arg = Deno.args[i];
    if (arg === "--env" || arg === "--env-path" || arg === "--envPath") {
      return Deno.args[i + 1];
    }
    if (arg.startsWith("--env=")) {
      return arg.slice("--env=".length);
    }
    if (arg.startsWith("--env-path=")) {
      return arg.slice("--env-path=".length);
    }
    if (arg.startsWith("--envPath=")) {
      return arg.slice("--envPath=".length);
    }
  }
  return undefined;
}
