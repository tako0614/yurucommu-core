import { Hono } from "hono";
import { load, stringify } from "jsr:@std/dotenv";
import { ensureFile } from "jsr:@std/fs/ensure-file";
import { join } from "jsr:@std/path";
import { createDB } from "../DB/mod.ts";
import { getEnv } from "../../shared/config.ts";
import { generateKeyPair } from "../../shared/crypto.ts";
import { genSalt, hash as bcryptHash } from "bcrypt";
import { issueSession } from "../utils/session.ts";
import authRequired from "../utils/auth.ts";

const app = new Hono();
// 初期設定はログイン後のみ実施可能にする
app.use("/setup", authRequired);
app.use("/setup/*", authRequired);

app.get("/setup/status", (c) => {
  const env = getEnv(c);
  // hashedPassword の有無のみで初期設定済みを判定
  const configured = Boolean(env["hashedPassword"]);
  return c.json({ configured });
});

app.post("/setup", async (c) => {
  const env = getEnv(c);
  // すでに設定済みの場合は拒否
  if (env["hashedPassword"]) {
    return c.json({ error: "already_configured" }, 400);
  }
  const { password, username, displayName, follow } = await c.req.json();
  if (!password || !username) {
    return c.json({ error: "invalid_parameters" }, 400);
  }

  // bcrypt でハッシュ化（login.ts の compare と整合）
  const salt = await genSalt(10);
  const hashed = await bcryptHash(password, salt);
  env.hashedPassword = hashed;

  const envPath = join("app", "api", ".env");
  await ensureFile(envPath);
  const fileEnv = await load({ envPath });
  fileEnv.hashedPassword = hashed;
  await Deno.writeTextFile(envPath, stringify(fileEnv));

  const keys = await generateKeyPair();
  const db = createDB(env);
  await db.createAccount({
    userName: username,
    displayName: displayName || username,
    avatarInitial: username.charAt(0).toUpperCase().substring(0, 2),
    privateKey: keys.privateKey,
    publicKey: keys.publicKey,
    followers: [],
    following: Array.isArray(follow) ? follow : [],
  });

  if (Array.isArray(follow)) {
    const db2 = createDB(env);
    for (const actor of follow) {
      await db2.follow("", actor);
    }
  }

  // UX 改善: 設定完了後に自動でセッションを発行してログイン状態にする
  await issueSession(c);

  return c.json({ success: true });
});

export default app;
