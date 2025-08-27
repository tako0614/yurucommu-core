import { createTakosApp } from "@takos/core";
import {
  connectDatabase,
  createDB,
  createMongoDataStore,
  setStoreFactory,
} from "./db/mod.ts";
import { getSystemKey } from "../core/services/system_actor.ts";
import { loadConfig } from "@takos/config";
import { getEnvPath } from "../packages/config/mod.ts";

// コマンドライン引数から .env のパスを取得
const envPath = getEnvPath();
const env = await loadConfig({ envPath });
await connectDatabase(env);
// takos 単体起動時は新抽象(Store)を登録（ホスト側では別途注入）
setStoreFactory((e) => createMongoDataStore(e));
const db = createDB(env);
if (env["ACTIVITYPUB_DOMAIN"]) {
  const domain = env["ACTIVITYPUB_DOMAIN"];
  await getSystemKey(db, domain);
}
const app = await createTakosApp(env, db);
const hostname = env["SERVER_HOST"];
const port = Number(env["SERVER_PORT"] ?? "80");
const cert = env["SERVER_CERT"]?.replace(/\\n/g, "\n");
const key = env["SERVER_KEY"]?.replace(/\\n/g, "\n");
const options = cert && key
  ? { hostname, port, cert, key }
  : { hostname, port };
Deno.serve(options, app.fetch);
