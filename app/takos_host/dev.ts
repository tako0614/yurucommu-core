import { TextLineStream } from "jsr:@std/streams/text-line-stream";
import { getEnvPath } from "../shared/args.ts";

function run(
  cmd: string[],
  cwd: string,
  env: Record<string, string> = {},
): Deno.ChildProcess {
  const command = new Deno.Command("deno", {
    args: cmd,
    cwd,
    env,
    stdout: "piped",
    stderr: "piped",
  });
  const process = command.spawn();
  const prefix = cwd === "./" || cwd === "."
    ? "server"
    : cwd.split("/").pop() ?? cwd;
  process.stdout
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new TextLineStream())
    .pipeTo(
      new WritableStream({
        write: (line) => console.log(`[${prefix}] ${line}`),
      }),
    );
  process.stderr
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new TextLineStream())
    .pipeTo(
      new WritableStream({
        write: (line) => console.error(`[${prefix} ERROR] ${line}`),
      }),
    );
  return process;
}

async function main() {
  // コマンドライン引数から .env のパスを取得
  const envPath = getEnvPath();
  const serverArgs = [
    "run",
    "-A",
  "--unstable-detect-cjs",
    "--watch",
    "--unsafely-ignore-certificate-errors",
    "main.ts",
  ];
  if (envPath) serverArgs.push("--env", envPath);
  const server = run(serverArgs, "./", { DEV: "1" });
  const client = run(["task", "dev"], "./client");
  await Promise.all([server.status, client.status]);
}

if (import.meta.main) {
  main();
}
