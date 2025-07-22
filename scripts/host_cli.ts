import { parse } from "jsr:@std/flags";
import { loadConfig } from "../app/shared/config.ts";
import { connectDatabase } from "../app/shared/db.ts";
import HostUser from "../app/models/takos_host/user.ts";
import Instance from "../app/models/takos_host/instance.ts";
import OAuthClient from "../app/models/takos_host/oauth_client.ts";
import Relay from "../app/models/takos/relay.ts";
import { createDB } from "../app/api/db.ts";
import { ensureTenant } from "../app/api/services/tenant.ts";
import { getSystemKey } from "../app/api/services/system_actor.ts";
import {
  createFollowActivity,
  createUndoFollowActivity,
  sendActivityPubObject,
} from "../app/api/utils/activitypub.ts";
import { hash } from "../app/takos_host/auth.ts";
interface Args {
  command: string;
  host?: string;
  user?: string;
  password?: string;
  inboxUrl?: string;
  relayId?: string;
}

function showHelp() {
  console.log(`使用方法: deno task host [command] [options]

Commands:
  list --user <USER>                      インスタンス一覧を表示
  create --user <USER> --host <HOST> [--password <PASS>]  インスタンス作成
  delete --user <USER> --host <HOST>      インスタンス削除
  set-pass --user <USER> --host <HOST> [--password <PASS>]  パスワード設定/解除
  relay-list                              リレー一覧を表示
  relay-add --inbox-url <URL>             リレーを追加
  relay-delete --relay-id <ID>            リレーを削除
`);
}

function parseArgsFn(): Args | null {
  const parsed = parse(Deno.args, {
    string: [
      "host",
      "user",
      "password",
      "inbox-url",
      "relay-id",
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
    inboxUrl: parsed["inbox-url"] ? String(parsed["inbox-url"]) : undefined,
    relayId: parsed["relay-id"] ? String(parsed["relay-id"]) : undefined,
  };
}

async function getUser(name: string) {
  const user = await HostUser.findOne({ userName: name });
  if (!user) throw new Error(`ユーザー ${name} が見つかりません`);
  return user;
}

async function listInstances(userName: string) {
  const user = await getUser(userName);
  const list = await Instance.find({ owner: user._id }).lean();
  for (const inst of list) {
    console.log(inst.host);
  }
}

async function createInstance(
  env: Record<string, string>,
  userName: string,
  host: string,
  pass?: string,
) {
  const user = await getUser(userName);
  const rootDomain = (env["ROOT_DOMAIN"] ?? "").toLowerCase();
  const reserved = (env["RESERVED_SUBDOMAINS"] ?? "")
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

  const exists = await Instance.findOne({ host: fullHost });
  if (exists) throw new Error("既に存在します");

  const instEnv: Record<string, string> = {};
  if (rootDomain) {
    instEnv.OAUTH_HOST = rootDomain;
    const redirect = `https://${fullHost}`;
    const clientId = redirect;
    let clientSecret: string;
    const existsCli = await OAuthClient.findOne({ clientId });
    if (existsCli) {
      clientSecret = existsCli.clientSecret;
    } else {
      clientSecret = crypto.randomUUID();
      const cli = new OAuthClient({
        clientId,
        clientSecret,
        redirectUri: redirect,
      });
      await cli.save();
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
  const inst = new Instance({ host: fullHost, owner: user._id, env: instEnv });
  await inst.save();
  await ensureTenant(fullHost, fullHost);
  if (rootDomain) {
    const db = createDB({
      ...env,
      ACTIVITYPUB_DOMAIN: fullHost,
      DB_MODE: "host",
    });
    await db.addRelay(rootDomain, "pull");
    await db.addRelay(rootDomain, "push");
  }
  console.log(`作成しました: ${fullHost}`);
}

async function deleteInstance(userName: string, host: string) {
  const user = await getUser(userName);
  await Instance.deleteOne({ host: host.toLowerCase(), owner: user._id });
  console.log("削除しました");
}

async function setPassword(userName: string, host: string, pass?: string) {
  const user = await getUser(userName);
  const inst = await Instance.findOne({
    host: host.toLowerCase(),
    owner: user._id,
  });
  if (!inst) throw new Error("インスタンスが見つかりません");
  if (pass) {
    const salt = crypto.randomUUID();
    const hashed = await hash(pass);
    inst.env = { ...(inst.env ?? {}), hashedPassword: hashed, salt };
  } else if (inst.env) {
    delete inst.env.hashedPassword;
    delete inst.env.salt;
  }
  await inst.save();
  console.log("更新しました");
}

async function listRelays() {
  const list = await Relay.find().lean<{
    _id: unknown;
    host: string;
    inboxUrl: string;
  }[]>();
  for (const r of list) console.log(`${r._id} ${r.host} ${r.inboxUrl}`);
}

async function addRelay(env: Record<string, string>, inboxUrl: string) {
  const relayHost = new URL(inboxUrl).hostname;
  const exists = await Relay.findOne({ host: relayHost });
  if (exists) throw new Error("既に存在します");
  const relay = new Relay({ host: relayHost, inboxUrl });
  await relay.save();
  const rootDomain = env["ROOT_DOMAIN"];
  if (rootDomain) {
    try {
      const db = createDB({
        ...env,
        ACTIVITYPUB_DOMAIN: rootDomain,
        DB_MODE: "host",
      });
      await db.addRelay(relayHost, "pull");
      await db.addRelay(relayHost, "push");
    } catch {
      /* ignore */
    }
    try {
      await getSystemKey(rootDomain);
      const actor = `https://${rootDomain}/users/system`;
      const follow = createFollowActivity(
        rootDomain,
        actor,
        "https://www.w3.org/ns/activitystreams#Public",
      );
      await sendActivityPubObject(inboxUrl, follow, "system", rootDomain, env);
    } catch (err) {
      console.error("Failed to follow relay:", err);
    }
  }
  console.log(`追加しました: ${relay.id}`);
}

async function deleteRelay(env: Record<string, string>, id: string) {
  const relay = await Relay.findByIdAndDelete(id);
  if (!relay) throw new Error("リレーが見つかりません");
  const rootDomain = env["ROOT_DOMAIN"];
  if (rootDomain) {
    try {
      const relayHost = relay.host ?? new URL(relay.inboxUrl).hostname;
      const db = createDB({
        ...env,
        ACTIVITYPUB_DOMAIN: rootDomain,
        DB_MODE: "host",
      });
      await db.removeRelay(relayHost);
    } catch {
      /* ignore */
    }
    try {
      await getSystemKey(rootDomain);
      const actor = `https://${rootDomain}/users/system`;
      const undo = createUndoFollowActivity(
        rootDomain,
        actor,
        "https://www.w3.org/ns/activitystreams#Public",
      );
      await sendActivityPubObject(
        relay.inboxUrl,
        undo,
        "system",
        rootDomain,
        env,
      );
    } catch (err) {
      console.error("Failed to undo follow:", err);
    }
  }
  console.log("削除しました");
}

async function main() {
  const args = parseArgsFn();
  if (!args) return;
  const env = await loadConfig();
  env["DB_MODE"] = "host";
  await connectDatabase(env);
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
      case "relay-list":
        await listRelays();
        break;
      case "relay-add":
        if (!args.inboxUrl) throw new Error("--inbox-url が必要です");
        await addRelay(env, args.inboxUrl);
        break;
      case "relay-delete":
        if (!args.relayId) throw new Error("--relay-id が必要です");
        await deleteRelay(env, args.relayId);
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
