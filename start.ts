// ルートから本番起動（watch 無し）
// 使い方: deno task start --env path/to/.env
// オプション: --only takos | host （片方のみ実行）

import { spawnDeno, waitAll } from "./scripts/proc.ts";
import { getEnvPath } from "./app/packages/config/mod.ts";

function getOnly(): "takos" | "host" | undefined {
  for (let i = 0; i < Deno.args.length; i++) {
    const a = Deno.args[i];
    if (a === "--only") return Deno.args[i + 1] as never;
    if (a.startsWith("--only=")) return a.slice("--only=".length) as never;
  }
}

const envPath = getEnvPath();
const only = getOnly();

const procs: Deno.ChildProcess[] = [];

if (!only || only === "takos") {
  const args = ["run", "-A", "index.ts"];
  if (envPath) args.push("--env", envPath);
  procs.push(spawnDeno(args, { cwd: "app/takos", prefix: "takos" }));
}

if (!only || only === "host") {
  const args = ["run", "-A", "main.ts"];
  if (envPath) args.push("--env", envPath);
  procs.push(spawnDeno(args, { cwd: "app/takos_host", prefix: "host" }));
}

const ok = await waitAll(...procs);
Deno.exit(ok ? 0 : 1);

