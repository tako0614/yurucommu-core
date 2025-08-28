// ルートから takos と takos_host を同時起動
// 使い方: deno task dev --env path/to/.env

import { spawnDeno, waitAll } from "./scripts/proc.ts";
import { getEnvPath } from "./app/packages/config/mod.ts";

const envPath = getEnvPath();

const takosArgs = ["task", "dev"];
if (envPath) takosArgs.push("--env", envPath);
const hostArgs = ["task", "dev"];
if (envPath) hostArgs.push("--env", envPath);

const takos = spawnDeno(takosArgs, { cwd: "app/takos", prefix: "takos" });
const host = spawnDeno(hostArgs, { cwd: "app/takos_host", prefix: "host" });

const ok = await waitAll(takos, host);
// プロセスは通常 watch 実行で継続するが、終了時のコードも明示
Deno.exit(ok ? 0 : 1);

