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

function getEnvArg(name: string): string | undefined {
  for (let i = 0; i < Deno.args.length; i++) {
    const a = Deno.args[i];
    if (a === name) return Deno.args[i + 1];
    if (a.startsWith(name + "=")) return a.slice((name + "=").length);
  }
}

// 優先順: --env-takos / --env-host > --env
const envCommon = getEnvPath();
const envTakos = getEnvArg("--env-takos") ?? envCommon;
const envHost = getEnvArg("--env-host") ?? envCommon;
const only = getOnly();

const procs: Deno.ChildProcess[] = [];

if (!only || only === "takos") {
  const args = ["run", "-A", "index.ts"];
  if (envTakos) args.push("--env", envTakos);
  procs.push(spawnDeno(args, { cwd: "app/takos", prefix: "takos" }));
}

if (!only || only === "host") {
  const args = ["run", "-A", "main.ts"];
  if (envHost) args.push("--env", envHost);
  procs.push(spawnDeno(args, { cwd: "app/takos_host", prefix: "host" }));
}

const ok = await waitAll(...procs);
Deno.exit(ok ? 0 : 1);
