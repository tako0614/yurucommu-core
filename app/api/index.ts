import { createTakosApp } from "./server.ts";
import { connectDatabase } from "../shared/db.ts";
import { ensureTenant } from "./services/tenant.ts";
import { loadConfig } from "../shared/config.ts";

const env = await loadConfig();
await connectDatabase(env);
if (env["ACTIVITYPUB_DOMAIN"]) {
  const domain = env["ACTIVITYPUB_DOMAIN"];
  await ensureTenant(domain, domain);
}
const app = await createTakosApp(env);
Deno.serve(app.fetch);
