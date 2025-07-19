import { parseArgs } from "jsr:@std/flags";

interface Args {
  url: string;
  user?: string;
  pass?: string;
  command: string;
  host?: string;
  instPass?: string;
  inboxUrl?: string;
  relayId?: string;
}

function showHelp() {
  console.log(`使用方法: deno task host [command] [options]

Commands:
  list                             インスタンス一覧を表示
  create --host <HOST> [--inst-pass <PASSWORD>]  新しいインスタンスを作成
  delete --host <HOST>             インスタンスを削除
  set-password --host <HOST> --inst-pass <PASSWORD>  インスタンスのパスワード設定
  relay-list                       リレー一覧を表示
  relay-add --inbox-url <URL>      リレーを追加
  relay-delete --relay-id <ID>     リレーを削除

Options:
  --url        takos host のベース URL (既定: http://localhost:8001)
  --user       ユーザー名 (省略時 system)
  --pass       ログインパスワード (省略可)
  --inst-pass  インスタンス用パスワード
  --inbox-url  追加するリレーのInbox URL
  --relay-id   削除するリレーのID
`);
}

function parse(): Args | null {
  const parsed = parseArgs(Deno.args, {
    string: [
      "url",
      "user",
      "pass",
      "host",
      "inst-pass",
      "inbox-url",
      "relay-id",
    ],
    boolean: ["help"],
    default: { url: "http://localhost:8001" },
  });

  if (parsed.help || parsed._.length === 0) {
    showHelp();
    return null;
  }

  const command = String(parsed._[0]);
  return {
    url: String(parsed.url),
    user: parsed.user ? String(parsed.user) : undefined,
    pass: parsed.pass ? String(parsed.pass) : undefined,
    command,
    host: parsed.host ? String(parsed.host) : undefined,
    instPass: parsed["inst-pass"] ? String(parsed["inst-pass"]) : undefined,
    inboxUrl: parsed["inbox-url"] ? String(parsed["inbox-url"]) : undefined,
    relayId: parsed["relay-id"] ? String(parsed["relay-id"]) : undefined,
  };
}

async function login(
  baseUrl: string,
  user: string,
  pass = "",
): Promise<string> {
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userName: user, password: pass }),
  });
  if (!res.ok) {
    throw new Error("ログインに失敗しました");
  }
  const setCookie = res.headers.get("set-cookie");
  const m = setCookie?.match(/hostSessionId=([^;]+)/);
  if (!m) throw new Error("Cookie を取得できませんでした");
  return `hostSessionId=${m[1]}`;
}

async function logout(baseUrl: string, cookie: string) {
  await fetch(`${baseUrl}/auth/logout`, {
    method: "DELETE",
    headers: { cookie },
  });
}

async function listInstances(baseUrl: string, cookie: string) {
  const res = await fetch(`${baseUrl}/user/instances`, { headers: { cookie } });
  if (!res.ok) {
    throw new Error("取得に失敗しました");
  }
  const list = await res.json();
  for (const inst of list) {
    console.log(inst.host);
  }
}

async function createInstance(
  baseUrl: string,
  cookie: string,
  host: string,
  pass?: string,
) {
  const body: Record<string, unknown> = { host };
  if (pass) body.password = pass;
  const res = await fetch(`${baseUrl}/user/instances`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`作成に失敗しました: ${err}`);
  }
  console.log("作成しました");
}

async function deleteInstance(baseUrl: string, cookie: string, host: string) {
  const res = await fetch(`${baseUrl}/user/instances/${host}`, {
    method: "DELETE",
    headers: { cookie },
  });
  if (!res.ok) {
    throw new Error("削除に失敗しました");
  }
  console.log("削除しました");
}

async function setPassword(
  baseUrl: string,
  cookie: string,
  host: string,
  pass: string,
) {
  const res = await fetch(`${baseUrl}/user/instances/${host}/password`, {
    method: "PUT",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ password: pass }),
  });
  if (!res.ok) {
    throw new Error("パスワード設定に失敗しました");
  }
  console.log("パスワードを更新しました");
}

async function listRelays(baseUrl: string, cookie: string) {
  const res = await fetch(`${baseUrl}/api/relays`, { headers: { cookie } });
  if (!res.ok) {
    throw new Error("リレー一覧の取得に失敗しました");
  }
  const data = await res.json();
  for (const r of data.relays ?? []) {
    console.log(`${r.id} ${r.inboxUrl}`);
  }
}

async function addRelay(baseUrl: string, cookie: string, url: string) {
  const res = await fetch(`${baseUrl}/api/relays`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ inboxUrl: url }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`追加に失敗しました: ${err}`);
  }
  console.log("追加しました");
}

async function deleteRelay(baseUrl: string, cookie: string, id: string) {
  const res = await fetch(`${baseUrl}/api/relays/${id}`, {
    method: "DELETE",
    headers: { cookie },
  });
  if (!res.ok) {
    throw new Error("削除に失敗しました");
  }
  console.log("削除しました");
}

async function main() {
  const args = parse();
  if (!args) return;
  const user = args.user ?? "system";
  const cookie = await login(args.url, user, args.pass ?? "");
  try {
    switch (args.command) {
      case "list":
        await listInstances(args.url, cookie);
        break;
      case "create":
        if (!args.host) throw new Error("--host が必要です");
        await createInstance(args.url, cookie, args.host, args.instPass);
        break;
      case "delete":
        if (!args.host) throw new Error("--host が必要です");
        await deleteInstance(args.url, cookie, args.host);
        break;
      case "set-password":
        if (!args.host || !args.instPass) {
          throw new Error("--host と --inst-pass が必要です");
        }
        await setPassword(args.url, cookie, args.host, args.instPass);
        break;
      case "relay-list":
        await listRelays(args.url, cookie);
        break;
      case "relay-add":
        if (!args.inboxUrl) throw new Error("--inbox-url が必要です");
        await addRelay(args.url, cookie, args.inboxUrl);
        break;
      case "relay-delete":
        if (!args.relayId) throw new Error("--relay-id が必要です");
        await deleteRelay(args.url, cookie, args.relayId);
        break;
      default:
        console.error("不明なコマンドです");
        showHelp();
    }
  } finally {
    await logout(args.url, cookie);
  }
}

if (import.meta.main) {
  main().catch((e) => console.error(e));
}
