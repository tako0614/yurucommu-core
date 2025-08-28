// 環境変数ファイル(.env)を生成するセットアップCLI
// 使い方例:
//   全体対話: deno task setup
//   takosのみ: deno task setup:takos
//   非対話で上書き: deno run -A scripts/setup_env.ts --target takos --force --password yourpass --domain dev.takos.jp

import { dirname, fromFileUrl, join as _join, resolve } from "jsr:@std/path";
import { ensureFile } from "jsr:@std/fs/ensure-file";
import { load as loadDotenv, stringify } from "jsr:@std/dotenv";
import { genSalt, hash as bcryptHash } from "https://deno.land/x/bcrypt@v0.4.1/mod.ts";

type Target = "takos" | "host" | "all";

interface Options {
  target: Target;
  force: boolean;
  yes: boolean; // 対話スキップ（既定値で作成）
  // 共通/任意上書き
  envTakos?: string;
  envHost?: string;
  mongo?: string;
  domain?: string; // takos: テナント/単体ドメイン, host: ルートドメイン
  // takos 向け
  password?: string; // 平文パスワード（ハッシュ保存）
}

function parseArgs(): Options {
  const o: Options = { target: "all", force: false, yes: false };
  for (let i = 0; i < Deno.args.length; i++) {
    const a = Deno.args[i];
    const next = () => Deno.args[i + 1];
    if (a === "--target") o.target = next() as Target;
    else if (a.startsWith("--target=")) o.target = a.slice(9) as Target;
    else if (a === "--force") o.force = true;
    else if (a === "-y" || a === "--yes") o.yes = true;
    else if (a === "--env-takos") o.envTakos = next();
    else if (a.startsWith("--env-takos=")) o.envTakos = a.slice("--env-takos=".length);
    else if (a === "--env-host") o.envHost = next();
    else if (a.startsWith("--env-host=")) o.envHost = a.slice("--env-host=".length);
    else if (a === "--mongo") o.mongo = next();
    else if (a.startsWith("--mongo=")) o.mongo = a.slice(8);
    else if (a === "--domain") o.domain = next();
    else if (a.startsWith("--domain=")) o.domain = a.slice(9);
    else if (a === "--password") o.password = next();
    else if (a.startsWith("--password=")) o.password = a.slice(11);
  }
  return o;
}

async function loadExampleEnv(path: string): Promise<Record<string, string>> {
  try {
    return await loadDotenv({ envPath: path });
  } catch {
    return {};
  }
}

function promptIfNeeded(label: string, def = "", yes = false): string {
  if (yes) return def;
  const v = prompt(`${label}${def ? ` [${def}]` : ""}`);
  return (v === null || v.trim() === "") ? def : v.trim();
}

async function createTakosEnv(outPath: string, opts: Options) {
  const root = dirname(fromFileUrl(import.meta.url));
  const examplePath = resolve(root, "../app/takos/.env.example");
  const example = await loadExampleEnv(examplePath);

  const mongo = opts.mongo ??
    promptIfNeeded("MONGO_URI (takos)", example.MONGO_URI ?? "mongodb://localhost:27017/takos-hono", opts.yes);
  const domain = opts.domain ??
    promptIfNeeded("ACTIVITYPUB_DOMAIN (takos)", example.ACTIVITYPUB_DOMAIN ?? "", opts.yes);

  const password = opts.password ?? (opts.yes ? "" : (prompt("管理者初期パスワード(空欄でスキップ)") ?? ""));
  let salt = example.salt ?? "";
  let hashedPassword = example.hashedPassword ?? "";
  if (password) {
    salt = await genSalt(10);
    hashedPassword = await bcryptHash(password, salt);
  }

  const env: Record<string, string> = {
    ...example,
    MONGO_URI: mongo,
    SERVER_HOST: example.SERVER_HOST ?? "",
    SERVER_PORT: example.SERVER_PORT ?? "80",
    SERVER_CERT: example.SERVER_CERT ?? "",
    SERVER_KEY: example.SERVER_KEY ?? "",
    hashedPassword,
    salt,
    ACTIVITYPUB_DOMAIN: domain,
    OAUTH_HOST: example.OAUTH_HOST ?? "",
    OAUTH_CLIENT_ID: example.OAUTH_CLIENT_ID ?? "",
    OAUTH_CLIENT_SECRET: example.OAUTH_CLIENT_SECRET ?? "",
    OBJECT_STORAGE_PROVIDER: example.OBJECT_STORAGE_PROVIDER ?? "local",
    LOCAL_STORAGE_DIR: example.LOCAL_STORAGE_DIR ?? "uploads",
    GRIDFS_BUCKET: example.GRIDFS_BUCKET ?? "uploads",
    R2_BUCKET: example.R2_BUCKET ?? "",
    R2_ACCOUNT_ID: example.R2_ACCOUNT_ID ?? "",
    R2_ACCESS_KEY_ID: example.R2_ACCESS_KEY_ID ?? "",
    R2_SECRET_ACCESS_KEY: example.R2_SECRET_ACCESS_KEY ?? "",
    FILE_MAX_SIZE: example.FILE_MAX_SIZE ?? "10MB",
    FILE_ALLOWED_MIME_TYPES: example.FILE_ALLOWED_MIME_TYPES ?? "",
    FILE_BLOCKED_MIME_TYPES: example.FILE_BLOCKED_MIME_TYPES ?? "",
    FILE_BLOCKED_EXTENSIONS: example.FILE_BLOCKED_EXTENSIONS ?? "",
    FIREBASE_CLIENT_EMAIL: example.FIREBASE_CLIENT_EMAIL ?? "",
    FIREBASE_PRIVATE_KEY: example.FIREBASE_PRIVATE_KEY ?? "",
    FIREBASE_API_KEY: example.FIREBASE_API_KEY ?? "",
    FIREBASE_AUTH_DOMAIN: example.FIREBASE_AUTH_DOMAIN ?? "",
    FIREBASE_PROJECT_ID: example.FIREBASE_PROJECT_ID ?? "",
    FIREBASE_STORAGE_BUCKET: example.FIREBASE_STORAGE_BUCKET ?? "",
    FIREBASE_MESSAGING_SENDER_ID: example.FIREBASE_MESSAGING_SENDER_ID ?? "",
    FIREBASE_APP_ID: example.FIREBASE_APP_ID ?? "",
    FIREBASE_VAPID_KEY: example.FIREBASE_VAPID_KEY ?? "",
    ADSENSE_CLIENT: example.ADSENSE_CLIENT ?? "",
    ADSENSE_SLOT: example.ADSENSE_SLOT ?? "",
    ADSENSE_ACCOUNT: example.ADSENSE_ACCOUNT ?? "",
  };

  await ensureFile(outPath);
  await Deno.writeTextFile(outPath, stringify(env));
  console.log(`✔ takos 用 .env を生成: ${outPath}`);
}

async function createHostEnv(outPath: string, opts: Options) {
  const root = dirname(fromFileUrl(import.meta.url));
  const examplePath = resolve(root, "../app/takos_host/.env.example");
  const example = await loadExampleEnv(examplePath);

  const mongo = opts.mongo ??
    promptIfNeeded("MONGO_URI (host)", example.MONGO_URI ?? "mongodb://localhost:27017/takos-host", opts.yes);
  const domain = opts.domain ??
    promptIfNeeded("ACTIVITYPUB_DOMAIN (root domain)", example.ACTIVITYPUB_DOMAIN ?? "", opts.yes);
  const freeLimit = promptIfNeeded(
    "FREE_PLAN_LIMIT",
    example.FREE_PLAN_LIMIT ?? "1",
    opts.yes,
  );
  const reserved = promptIfNeeded(
    "RESERVED_SUBDOMAINS (カンマ区切り)",
    example.RESERVED_SUBDOMAINS ?? "www,admin",
    opts.yes,
  );
  const terms = promptIfNeeded("TERMS_FILE (任意)", example.TERMS_FILE ?? "", opts.yes);

  const env: Record<string, string> = {
    ...example,
    MONGO_URI: mongo,
    SERVER_HOST: example.SERVER_HOST ?? "",
    SERVER_PORT: example.SERVER_PORT ?? "80",
    SERVER_CERT: example.SERVER_CERT ?? "",
    SERVER_KEY: example.SERVER_KEY ?? "",
    ACTIVITYPUB_DOMAIN: domain,
    FREE_PLAN_LIMIT: freeLimit,
    RESERVED_SUBDOMAINS: reserved,
    TERMS_FILE: terms,
    SMTP_HOST: example.SMTP_HOST ?? "smtp.gmail.com",
    SMTP_PORT: example.SMTP_PORT ?? "465",
    SMTP_USER: example.SMTP_USER ?? "",
    SMTP_PASS: example.SMTP_PASS ?? "",
    SMTP_SSL: example.SMTP_SSL ?? "465",
    MAIL_FROM: example.MAIL_FROM ?? "",
    FIREBASE_CLIENT_EMAIL: example.FIREBASE_CLIENT_EMAIL ?? "",
    FIREBASE_PRIVATE_KEY: example.FIREBASE_PRIVATE_KEY ?? "",
    FIREBASE_API_KEY: example.FIREBASE_API_KEY ?? "",
    FIREBASE_AUTH_DOMAIN: example.FIREBASE_AUTH_DOMAIN ?? "",
    FIREBASE_PROJECT_ID: example.FIREBASE_PROJECT_ID ?? "",
    FIREBASE_STORAGE_BUCKET: example.FIREBASE_STORAGE_BUCKET ?? "",
    FIREBASE_MESSAGING_SENDER_ID: example.FIREBASE_MESSAGING_SENDER_ID ?? "",
    FIREBASE_APP_ID: example.FIREBASE_APP_ID ?? "",
    FIREBASE_VAPID_KEY: example.FIREBASE_VAPID_KEY ?? "",
    FASP_SERVER_DISABLED: example.FASP_SERVER_DISABLED ?? "",
    FASP_DEFAULT_BASE_URL: example.FASP_DEFAULT_BASE_URL ?? "",
  };

  await ensureFile(outPath);
  await Deno.writeTextFile(outPath, stringify(env));
  console.log(`✔ takos host 用 .env を生成: ${outPath}`);
}

async function main() {
  const opts = parseArgs();
  const root = dirname(fromFileUrl(import.meta.url));
  const takosOut = opts.envTakos ?? resolve(root, "../app/takos/.env");
  const hostOut = opts.envHost ?? resolve(root, "../app/takos_host/.env");

  if (!opts.force) {
    // 既存ファイルがある場合は確認
    const existing: string[] = [];
    try { await Deno.stat(takosOut); existing.push("takos"); } catch { /* ignore */ }
    try { await Deno.stat(hostOut); existing.push("host"); } catch { /* ignore */ }
    if (existing.length) {
      if (opts.yes) {
        // 続行
      } else {
        const ans = prompt(`既に ${existing.join(",")} の .env が存在します。上書きしますか? [y/N]`)?.toLowerCase() ?? "n";
        if (ans !== "y") {
          console.log("キャンセルしました。");
          Deno.exit(0);
        }
      }
    }
  }

  const targets: Target[] = opts.target === "all" ? ["takos", "host"] : [opts.target];
  for (const t of targets) {
    if (t === "takos") await createTakosEnv(takosOut, opts);
    if (t === "host") await createHostEnv(hostOut, opts);
  }
  console.log("完了しました。");
}

if (import.meta.main) {
  await main();
}

