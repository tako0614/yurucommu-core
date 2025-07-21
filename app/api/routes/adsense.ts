import { Hono } from "hono";
import { getEnv } from "../../shared/config.ts";

const app = new Hono();

app.get("/adsense/config", (c) => {
  const env = getEnv(c);
  return c.json({
    client: env["ADSENSE_CLIENT"] ?? null,
    slot: env["ADSENSE_SLOT"] ?? null,
    account: env["ADSENSE_ACCOUNT"] ?? null,
  });
});

export default app;
