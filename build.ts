// ルートからビルド一括実行
// 使い方: deno task build

import { spawnDeno, waitAll } from "./scripts/proc.ts";

const hostBuild = spawnDeno(["task", "build"], {
  cwd: "app/takos_host",
  prefix: "host:build",
});

const clientBuild = spawnDeno(["task", "build"], {
  cwd: "app/client",
  prefix: "client:build",
});

const ok = await waitAll(hostBuild, clientBuild);
Deno.exit(ok ? 0 : 1);

