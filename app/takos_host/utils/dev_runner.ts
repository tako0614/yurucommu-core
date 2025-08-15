import { TextLineStream } from "jsr:@std/streams/text-line-stream";

export interface SpawnOptions {
  cwd: string;
  env?: Record<string, string>;
  prefix?: string;
}

/**
 * Deno.Command を spawn し、行単位でログ出力するヘルパー。
 */
export function spawnDeno(args: string[], { cwd, env = {}, prefix }: SpawnOptions): Deno.ChildProcess {
  const command = new Deno.Command("deno", {
    args,
    cwd,
    env,
    stdout: "piped",
    stderr: "piped",
  });
  const process = command.spawn();
  const tag = prefix ?? (cwd === "./" || cwd === "." ? "server" : cwd.split("/").pop() ?? cwd);
  process.stdout
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new TextLineStream())
    .pipeTo(new WritableStream({ write: (line) => console.log(`[${tag}] ${line}`) }))
    .catch(() => {});
  process.stderr
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new TextLineStream())
    .pipeTo(new WritableStream({ write: (line) => console.error(`[${tag} ERROR] ${line}`) }))
    .catch(() => {});
  return process;
}

/** ホストサーバー (main.ts) を起動 */
export function startHostServer(envPath?: string) {
  const args = [
    "run",
    "-A",
    "--unstable-detect-cjs",
    "--watch",
    "--unsafely-ignore-certificate-errors",
    "main.ts",
  ];
  if (envPath) args.push("--env", envPath);
  return spawnDeno(args, { cwd: "./", env: { DEV: "1" } });
}

/** Client (./client) の Vite dev を起動 (deno task dev 想定) */
export function startClientDev() {
  return spawnDeno(["task", "dev"], { cwd: "./client" });
}

/** ホスト + クライアントの開発同時起動 */
export async function runHostDev(envPath?: string) {
  const server = startHostServer(envPath);
  const client = startClientDev();
  const [serverStatus, clientStatus] = await Promise.all([server.status, client.status]);
  return { serverStatus, clientStatus };
}
