import { Hono } from "hono";
import { load, stringify } from "jsr:@std/dotenv";
import { ensureFile } from "jsr:@std/fs/ensure-file";
import { join } from "jsr:@std/path";
import { createAccount } from "../db.ts";
import { createDB } from "../db.ts";
import { getEnv } from "../../shared/config.ts";
import authRequired from "../utils/auth.ts";
import { generateKeyPair, sha256Hex } from "../../shared/crypto.ts";

const app = new Hono();
app.use("/setup", authRequired);
app.use("/setup/*", authRequired);

app.get("/setup/status", (c) => {
  const env = getEnv(c);
  const configured = Boolean(env["hashedPassword"] && env["salt"]);
  return c.json({ configured });
});

app.post("/setup", async (c) => {
  const env = getEnv(c);
  if (env["hashedPassword"] && env["salt"]) {
    return c.json({ error: "already_configured" }, 400);
  }
  const { password, username, displayName, follow } = await c.req.json();
  if (!password || !username) {
    return c.json({ error: "invalid_parameters" }, 400);
  }

  const salt = crypto.randomUUID().replace(/-/g, "");
  const hashed = await sha256Hex(password + salt);
  env.hashedPassword = hashed;
  env.salt = salt;

  const envPath = join("app", "api", ".env");
  await ensureFile(envPath);
  const fileEnv = await load({ envPath });
  fileEnv.hashedPassword = hashed;
  fileEnv.salt = salt;
  await Deno.writeTextFile(envPath, stringify(fileEnv));

  const keys = await generateKeyPair();
  await createAccount(env, {
    userName: username,
    displayName: displayName || username,
    avatarInitial: username.charAt(0).toUpperCase().substring(0, 2),
    privateKey: keys.privateKey,
    publicKey: keys.publicKey,
    followers: [],
    following: Array.isArray(follow) ? follow : [],
  });

  if (Array.isArray(follow)) {
    const db = createDB(env);
    for (const actor of follow) {
      await db.follow("", actor);
    }
  }

  return c.json({ success: true });
});

export default app;
