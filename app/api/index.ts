import { createTakosApp } from "./server.ts";
import { connectDatabase } from "../shared/db.ts";
import { ensureTenant } from "./services/tenant.ts";
import { createDB } from "./DB/mod.ts";
import { loadConfig } from "../shared/config.ts";

const env = await loadConfig();
await connectDatabase(env);
if (env["ACTIVITYPUB_DOMAIN"]) {
  const domain = env["ACTIVITYPUB_DOMAIN"];
  const db = createDB(env);
  await ensureTenant(db, domain, domain);
}
const app = await createTakosApp(env);
Deno.serve(app.fetch);
