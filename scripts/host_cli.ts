import { parse } from "jsr:@std/flags";
import { loadConfig } from "../app/shared/config.ts";
import { connectDatabase } from "../app/shared/db.ts";
import { createDB } from "../app/api/DB/mod.ts";
import { ensureTenant } from "../app/api/services/tenant.ts";
import type { DB } from "../app/shared/db.ts";
import { hash } from "../app/takos_host/auth.ts";
interface Args {
  command: string;
  host?: string;
  user?: string;
  password?: string;
}

let env: Record<string, string> = {};
let db: DB;

function showHelp() {
  console.log(`使用方法: deno task host [command] [options]

Commands:
  list --user <USER>                      インスタンス一覧を表示
  create --user <USER> --host <HOST> [--password <PASS>]  インスタンス作成
  delete --user <USER> --host <HOST>      インスタンス削除
  set-pass --user <USER> --host <HOST> [--password <PASS>]  パスワード設定/解除
`);
}

function parseArgsFn(): Args | null {
  const parsed = parse(Deno.args, {
    string: [
      "host",
      "user",
      "password",
    ],
    boolean: ["help"],
  });
  if (parsed.help || parsed._.length === 0) {
    showHelp();
    return null;
  }
  return {
    command: String(parsed._[0]),
    host: parsed.host ? String(parsed.host) : undefined,
    user: parsed.user ? String(parsed.user) : undefined,
    password: parsed.password ? String(parsed.password) : undefined,
  };
}

async function getUser(name: string) {
  const col = (await db.getDatabase()).collection("hostusers");
  const user = await col.findOne<{ _id: unknown }>({ userName: name });
  if (!user) throw new Error(`ユーザー ${name} が見つかりません`);
  return user;
}

async function listInstances(userName: string) {
  const user = await getUser(userName);
  const col = (await db.getDatabase()).collection("instances");
  const list = await col.find({ owner: user._id }).toArray();
  for (const inst of list) {
    console.log(inst.host);
  }
}

async function createInstance(
  cfg: Record<string, string>,
  userName: string,
  host: string,
  pass?: string,
) {
  const user = await getUser(userName);
  const col = (await db.getDatabase()).collection("instances");
  const rootDomain = (cfg["ROOT_DOMAIN"] ?? "").toLowerCase();
  const reserved = (cfg["RESERVED_SUBDOMAINS"] ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s);
  let fullHost = host.toLowerCase();
  if (rootDomain) {
    if (host.includes(".")) {
      if (!host.endsWith(`.${rootDomain}`) || host === rootDomain) {
        throw new Error("ドメインが不正です");
      }
      fullHost = host;
      const sub = host.slice(0, -rootDomain.length - 1);
      if (reserved.includes(sub)) {
        throw new Error("利用できないサブドメインです");
      }
    } else {
      if (reserved.includes(host)) {
        throw new Error("利用できないサブドメインです");
      }
      fullHost = `${host}.${rootDomain}`;
    }
  } else if (reserved.includes(host)) {
    throw new Error("利用できないサブドメインです");
  }

  const exists = await col.findOne({ host: fullHost });
  if (exists) throw new Error("既に存在します");

  const instEnv: Record<string, string> = {};
  if (rootDomain) {
    instEnv.OAUTH_HOST = rootDomain;
    const redirect = `https://${fullHost}`;
    const clientId = redirect;
    let clientSecret: string;
    const cliCol = (await db.getDatabase()).collection("oauthclients");
    const existsCli = await cliCol.findOne<{ clientSecret: string }>({
      clientId,
    });
    if (existsCli) {
      clientSecret = existsCli.clientSecret;
    } else {
      clientSecret = crypto.randomUUID();
      await cliCol.insertOne({
        clientId,
        clientSecret,
        redirectUri: redirect,
        createdAt: new Date(),
      });
    }
    instEnv.OAUTH_CLIENT_ID = clientId;
    instEnv.OAUTH_CLIENT_SECRET = clientSecret;
  }
  if (pass) {
    const salt = crypto.randomUUID();
    const hashed = await hash(pass);
    instEnv.hashedPassword = hashed;
    instEnv.salt = salt;
  }
  await col.insertOne({
    host: fullHost,
    owner: user._id,
    env: instEnv,
    createdAt: new Date(),
  });
  await ensureTenant(db, fullHost, fullHost);
  console.log(`作成しました: ${fullHost}`);
}

async function deleteInstance(userName: string, host: string) {
  const user = await getUser(userName);
  const col = (await db.getDatabase()).collection("instances");
  await col.deleteOne({ host: host.toLowerCase(), owner: user._id });
  console.log("削除しました");
}

async function setPassword(userName: string, host: string, pass?: string) {
  const user = await getUser(userName);
  const col = (await db.getDatabase()).collection("instances");
  const inst = await col.findOne<
    { _id: unknown; env?: Record<string, string> }
  >(
    { host: host.toLowerCase(), owner: user._id },
  );
  if (!inst) throw new Error("インスタンスが見つかりません");
  if (pass) {
    const salt = crypto.randomUUID();
    const hashed = await hash(pass);
    const newEnv = { ...(inst.env ?? {}), hashedPassword: hashed, salt };
    await col.updateOne({ _id: inst._id }, { $set: { env: newEnv } });
  } else if (inst.env) {
    const newEnv = { ...inst.env };
    delete newEnv.hashedPassword;
    delete newEnv.salt;
    await col.updateOne({ _id: inst._id }, { $set: { env: newEnv } });
  }
  console.log("更新しました");
}

// relay 操作は廃止

async function main() {
  const args = parseArgsFn();
  if (!args) return;
  env = await loadConfig();
  env["DB_MODE"] = "host";
  await connectDatabase(env);
  db = createDB(env);
  const user = args.user ?? "system";
  try {
    switch (args.command) {
      case "list":
        await listInstances(user);
        break;
      case "create":
        if (!args.host) throw new Error("--host が必要です");
        await createInstance(env, user, args.host, args.password);
        break;
      case "delete":
        if (!args.host) throw new Error("--host が必要です");
        await deleteInstance(user, args.host);
        break;
      case "set-pass":
        if (!args.host) throw new Error("--host が必要です");
        await setPassword(user, args.host, args.password);
        break;
      default:
        console.error("不明なコマンドです");
        showHelp();
    }
  } finally {
    // nothing
  }
}

if (import.meta.main) {
  main().catch((e) => console.error(e));
}
