import { Hono } from "hono";
import { getEnv } from "../../shared/config.ts";
import { join } from "jsr:@std/path";
import { ensureFile } from "jsr:@std/fs/ensure-file";
import { load, stringify } from "jsr:@std/dotenv";
import { genSalt, hash as bcryptHash } from "bcrypt";

const app = new Hono();

// システムセットアップの必要性を返す（hashedPassword の有無で判定）
app.get("/system/setup/status", (c) => {
  const env = getEnv(c);
  const configured = Boolean(env["hashedPassword"]);
  return c.json({ configured });
});

// 初回のみ .env に hashedPassword を保存する
app.post("/system/setup", async (c) => {
  const env = getEnv(c);
  if (env["hashedPassword"]) {
    return c.json({ error: "already_configured" }, 400);
  }
  const { password, domain } = await c.req.json();
  if (!password || typeof password !== "string" || password.length < 8) {
    return c.json({ error: "invalid_password" }, 400);
  }

  const salt = await genSalt(10);
  const hashed = await bcryptHash(password, salt);

  const envPath = join("app", "api", ".env");
  await ensureFile(envPath);
  const fileEnv = await load({ envPath });
  fileEnv.hashedPassword = hashed;
  if (!fileEnv["ACTIVITYPUB_DOMAIN"] && typeof domain === "string" && domain.trim()) {
    fileEnv.ACTIVITYPUB_DOMAIN = domain.trim();
  }
  await Deno.writeTextFile(envPath, stringify(fileEnv));

  return c.json({ success: true });
});

export default app;

