import { createTakosApp } from "./server.ts";
import { connectDatabase } from "./DB/mongo_conn.ts";
import { ensureTenant } from "./services/tenant.ts";
import { setStoreFactory, createDB } from "./DB/mod.ts";
import { createMongoDataStore } from "./DB/mongo_store.ts";
import { getSystemKey } from "./services/system_actor.ts";
import { loadConfig } from "../shared/config.ts";
import { getEnvPath } from "../shared/args.ts";

// コマンドライン引数から .env のパスを取得
const envPath = getEnvPath();
const env = await loadConfig({ envPath });
await connectDatabase(env);
// takos 単体起動時は新抽象(Store)を登録（ホスト側では別途注入）
setStoreFactory((e) => createMongoDataStore(e));
if (env["ACTIVITYPUB_DOMAIN"]) {
  const domain = env["ACTIVITYPUB_DOMAIN"];
  const db = createDB(env);
  await ensureTenant(db, domain, domain);
  await getSystemKey(db, domain);
}
const app = await createTakosApp(env);
const hostname = env["SERVER_HOST"];
const port = Number(env["SERVER_PORT"] ?? "80");
const cert = env["SERVER_CERT"]?.replace(/\\n/g, "\n");
const key = env["SERVER_KEY"]?.replace(/\\n/g, "\n");
const options = cert && key
  ? { hostname, port, cert, key }
  : { hostname, port };
Deno.serve(options, app.fetch);
