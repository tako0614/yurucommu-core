import { createTakosApp } from "@takos/core";
import type { DataStore } from "../core/db/types.ts";
import { createDB, createPrismaDataStore, setStoreFactory } from "./db/mod.ts";
import { getSystemKey } from "../core/services/system_actor.ts";
import { loadConfig } from "@takos/config";
import { getEnvPath } from "../packages/config/mod.ts";

// コマンドライン引数から .env のパスを取得（未指定時はローカル .env を既定に）
const envPathArg = getEnvPath();
const defaultEnvPath = new URL("./.env", import.meta.url).toString();
const env = await loadConfig({ envPath: envPathArg ?? defaultEnvPath });
// takos 単体起動時は新抽象(Store)を登録（ホスト側では別途注入）
// 明示的に core の DataStore 型としてキャストして型不一致を回避
// takos は Prisma 固定（Mongo を廃止）
setStoreFactory((e: Record<string, string>) =>
  createPrismaDataStore(e) as unknown as DataStore
);
const db = createDB(env);
if (env["ACTIVITYPUB_DOMAIN"]) {
  const domain = env["ACTIVITYPUB_DOMAIN"];
  await getSystemKey(db, domain);
}
const app = await createTakosApp(env, db);

const hostname = env["SERVER_HOST"];
const port = Number(env["SERVER_PORT"] ?? "80");
// SERVER_CERT / SERVER_KEY may be stored with surrounding quotes and `\n` escapes
// (for example when written as "-----BEGIN...\n...\n" in .env files). Normalize
// by removing optional surrounding quotes and converting literal "\\n" sequences
// to real newlines so Deno's TLS loader can parse the PEM blocks correctly.
function normalizePem(value?: string): string | undefined {
  if (!value) return undefined;
  // remove surrounding double quotes (multi-line values in dotenv are often
  // written as a quoted string containing \n escapes)
  const unquoted = value.replace(/^"([\s\S]*)"$/, "$1");
  return unquoted.replace(/\\n/g, "\n");
}

const cert = normalizePem(env["SERVER_CERT"]);
const key = normalizePem(env["SERVER_KEY"]);
const options = cert && key
  ? { hostname, port, cert, key }
  : { hostname, port };

try {
  Deno.serve(options, app.fetch);
} catch (e) {
  // AddrNotAvailable: 要求したアドレスのコンテキストが無効です (Windows os error 10049)
  // サーバーが特定のローカル IP にバインドできない場合は 0.0.0.0 にフォールバックして再試行する
  if (e instanceof Error && /AddrNotAvailable|os error 10049/.test(e.message)) {
    console.warn(
      `警告: ホスト ${hostname} にバインドできません。0.0.0.0 にフォールバックして再試行します: ${e.message}`,
    );
    const fallbackOptions = cert && key
      ? { hostname: "0.0.0.0", port, cert, key }
      : { hostname: "0.0.0.0", port };
    Deno.serve(fallbackOptions, app.fetch);
  } else {
    throw e;
  }
}
