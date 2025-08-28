// ルートから takos と takos_host を同時起動
// 使い方: deno task dev --env path/to/.env

import { spawnDeno, waitAll } from "./scripts/proc.ts";
import { getEnvPath } from "./app/packages/config/mod.ts";

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

const takosArgs = ["task", "dev"];
if (envTakos) takosArgs.push("--env", envTakos);
const hostArgs = ["task", "dev"];
if (envHost) hostArgs.push("--env", envHost);

const takos = spawnDeno(takosArgs, { cwd: "app/takos", prefix: "takos" });
const host = spawnDeno(hostArgs, { cwd: "app/takos_host", prefix: "host" });

const ok = await waitAll(takos, host);
// プロセスは通常 watch 実行で継続するが、終了時のコードも明示
Deno.exit(ok ? 0 : 1);
