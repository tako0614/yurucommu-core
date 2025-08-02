import { createTakosApp } from "./server.ts";
import { connectDatabase } from "../shared/db.ts";
import { ensureTenant } from "./services/tenant.ts";
import { createDB } from "./DB/mod.ts";
import { loadConfig } from "../shared/config.ts";
import { getEnvPath } from "../shared/args.ts";

// コマンドライン引数から .env のパスを取得
const envPath = getEnvPath();
const env = await loadConfig({ envPath });
await connectDatabase(env);
if (env["ACTIVITYPUB_DOMAIN"]) {
  const domain = env["ACTIVITYPUB_DOMAIN"];
  const db = createDB(env);
  await ensureTenant(db, domain, domain);
}
const app = await createTakosApp(env);
const hostname = env["SERVER_HOST"];
Deno.serve({ hostname }, app.fetch);
