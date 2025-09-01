// 環境変数ファイル(.env)を生成するセットアップCLI
// 使い方例:
//   全体対話: deno task setup
//   takosのみ: deno task setup:takos
//   非対話で上書き: deno run -A scripts/setup_env.ts --target takos --force --password yourpass --domain dev.takos.jp

import { dirname, fromFileUrl, resolve } from "jsr:@std/path";
import { ensureFile } from "jsr:@std/fs/ensure-file";
import { load as loadDotenv, stringify } from "jsr:@std/dotenv";
import {
  genSalt,
  hash as bcryptHash,
} from "https://deno.land/x/bcrypt@v0.4.1/mod.ts";

type Target = "takos" | "host" | "all";

interface Options {
  target: Target;
  force: boolean;
  yes: boolean; // 対話スキップ（既定値で作成）
  // 共通/任意上書き
  envTakos?: string;
  envHost?: string;
  // Mongo は takos 本体向けのみ使用（host は D1/Prisma 前提）
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
    else if (a.startsWith("--env-takos=")) {
      o.envTakos = a.slice("--env-takos=".length);
    } else if (a === "--env-host") o.envHost = next();
    else if (a.startsWith("--env-host=")) {
      o.envHost = a.slice("--env-host=".length);
    } else if (a === "--mongo") o.mongo = next();
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

function promptYesNo(question: string, yes = false): boolean {
  if (yes) return false; // --yes時はデフォルト値を使用
  const v = prompt(`${question} [y/N]`)?.toLowerCase();
  return v === "y" || v === "yes";
}

function validateDomain(domain: string): boolean {
  if (!domain) return true; // 空欄は許可
  // より厳密なドメイン検証
  const domainRegex =
    /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  return domainRegex.test(domain) && domain.length <= 253;
}

function validateEmail(email: string): boolean {
  if (!email) return true; // 空欄は許可
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

async function createTakosEnv(outPath: string, opts: Options) {
  const root = dirname(fromFileUrl(import.meta.url));
  const examplePath = resolve(root, "../app/takos/.env.example");
  const example = await loadExampleEnv(examplePath);

  const mongo = opts.mongo ??
    promptIfNeeded(
      "MONGO_URI (takos)",
      example.MONGO_URI ?? "mongodb://localhost:27017/takos-hono",
      opts.yes,
    );
  const domain = opts.domain ??
    promptIfNeeded(
      "ACTIVITYPUB_DOMAIN (takos)",
      example.ACTIVITYPUB_DOMAIN ?? "",
      opts.yes,
    );

  // サーバー設定
  const serverHost = promptIfNeeded(
    "SERVER_HOST (空欄で0.0.0.0)",
    example.SERVER_HOST ?? "",
    opts.yes,
  );
  const serverPort = promptIfNeeded(
    "SERVER_PORT",
    example.SERVER_PORT ?? "80",
    opts.yes,
  );
  const useHttps = promptYesNo("HTTPSを使用しますか?", opts.yes);
  let serverCert = example.SERVER_CERT ?? "";
  let serverKey = example.SERVER_KEY ?? "";
  if (useHttps) {
    serverCert = promptIfNeeded("SERVER_CERT (証明書内容)", "", opts.yes);
    serverKey = promptIfNeeded("SERVER_KEY (秘密鍵内容)", "", opts.yes);
  }

  // OAuth設定
  const useOauth = promptYesNo("OAuth認証を使用しますか?", opts.yes);
  let oauthHost = example.OAUTH_HOST ?? "";
  let oauthClientId = example.OAUTH_CLIENT_ID ?? "";
  let oauthClientSecret = example.OAUTH_CLIENT_SECRET ?? "";
  if (useOauth) {
    oauthHost = promptIfNeeded("OAUTH_HOST", "", opts.yes);
    if (oauthHost && !validateDomain(oauthHost)) {
      console.warn("⚠️ 警告: OAUTH_HOSTの形式が正しくない可能性があります");
    }
    oauthClientId = promptIfNeeded("OAUTH_CLIENT_ID", "", opts.yes);
    oauthClientSecret = promptIfNeeded("OAUTH_CLIENT_SECRET", "", opts.yes);
  }

  // ストレージ設定
  const storageProvider = promptIfNeeded(
    "OBJECT_STORAGE_PROVIDER (local/gridfs/r2)",
    example.OBJECT_STORAGE_PROVIDER ?? "local",
    opts.yes,
  );
  let localStorageDir = example.LOCAL_STORAGE_DIR ?? "uploads";
  let gridfsBucket = example.GRIDFS_BUCKET ?? "uploads";
  let r2Bucket = example.R2_BUCKET ?? "";
  let r2AccountId = example.R2_ACCOUNT_ID ?? "";
  let r2AccessKeyId = example.R2_ACCESS_KEY_ID ?? "";
  let r2SecretAccessKey = example.R2_SECRET_ACCESS_KEY ?? "";

  if (storageProvider === "local") {
    localStorageDir = promptIfNeeded(
      "LOCAL_STORAGE_DIR",
      localStorageDir,
      opts.yes,
    );
  } else if (storageProvider === "gridfs") {
    gridfsBucket = promptIfNeeded("GRIDFS_BUCKET", gridfsBucket, opts.yes);
  } else if (storageProvider === "r2") {
    r2Bucket = promptIfNeeded("R2_BUCKET", "", opts.yes);
    r2AccountId = promptIfNeeded("R2_ACCOUNT_ID", "", opts.yes);
    r2AccessKeyId = promptIfNeeded("R2_ACCESS_KEY_ID", "", opts.yes);
    r2SecretAccessKey = promptIfNeeded("R2_SECRET_ACCESS_KEY", "", opts.yes);
  }

  // ファイル制限設定
  const fileMaxSize = promptIfNeeded(
    "FILE_MAX_SIZE (例: 10MB)",
    example.FILE_MAX_SIZE ?? "10MB",
    opts.yes,
  );
  const fileAllowedTypes = promptIfNeeded(
    "FILE_ALLOWED_MIME_TYPES (空欄で全許可)",
    example.FILE_ALLOWED_MIME_TYPES ?? "",
    opts.yes,
  );

  // FCM設定
  const useFcm = promptYesNo(
    "Firebase Cloud Messagingを使用しますか?",
    opts.yes,
  );
  let firebaseClientEmail = example.FIREBASE_CLIENT_EMAIL ?? "";
  let firebasePrivateKey = example.FIREBASE_PRIVATE_KEY ?? "";
  let firebaseApiKey = example.FIREBASE_API_KEY ?? "";
  let firebaseAuthDomain = example.FIREBASE_AUTH_DOMAIN ?? "";
  let firebaseProjectId = example.FIREBASE_PROJECT_ID ?? "";
  let firebaseStorageBucket = example.FIREBASE_STORAGE_BUCKET ?? "";
  let firebaseMessagingSenderId = example.FIREBASE_MESSAGING_SENDER_ID ?? "";
  let firebaseAppId = example.FIREBASE_APP_ID ?? "";
  let firebaseVapidKey = example.FIREBASE_VAPID_KEY ?? "";

  if (useFcm) {
    firebaseClientEmail = promptIfNeeded("FIREBASE_CLIENT_EMAIL", "", opts.yes);
    if (firebaseClientEmail && !validateEmail(firebaseClientEmail)) {
      console.warn(
        "⚠️ 警告: FIREBASE_CLIENT_EMAILの形式が正しくない可能性があります",
      );
    }
    firebasePrivateKey = promptIfNeeded("FIREBASE_PRIVATE_KEY", "", opts.yes);
    firebaseApiKey = promptIfNeeded("FIREBASE_API_KEY", "", opts.yes);
    firebaseAuthDomain = promptIfNeeded("FIREBASE_AUTH_DOMAIN", "", opts.yes);
    if (firebaseAuthDomain && !validateDomain(firebaseAuthDomain)) {
      console.warn(
        "⚠️ 警告: FIREBASE_AUTH_DOMAINの形式が正しくない可能性があります",
      );
    }
    firebaseProjectId = promptIfNeeded("FIREBASE_PROJECT_ID", "", opts.yes);
    firebaseStorageBucket = promptIfNeeded(
      "FIREBASE_STORAGE_BUCKET",
      "",
      opts.yes,
    );
    firebaseMessagingSenderId = promptIfNeeded(
      "FIREBASE_MESSAGING_SENDER_ID",
      "",
      opts.yes,
    );
    firebaseAppId = promptIfNeeded("FIREBASE_APP_ID", "", opts.yes);
    firebaseVapidKey = promptIfNeeded("FIREBASE_VAPID_KEY", "", opts.yes);
  }

  const password = opts.password ??
    (opts.yes ? "" : (prompt("管理者初期パスワード(空欄でスキップ)") ?? ""));
  let salt = example.salt ?? "";
  let hashedPassword = example.hashedPassword ?? "";
  if (password) {
    salt = await genSalt(10);
    hashedPassword = await bcryptHash(password, salt);
  }

  const env: Record<string, string> = {
    ...example,
    MONGO_URI: mongo,
    SERVER_HOST: serverHost,
    SERVER_PORT: serverPort,
    SERVER_CERT: serverCert,
    SERVER_KEY: serverKey,
    hashedPassword,
    salt,
    ACTIVITYPUB_DOMAIN: domain,
    OAUTH_HOST: oauthHost,
    OAUTH_CLIENT_ID: oauthClientId,
    OAUTH_CLIENT_SECRET: oauthClientSecret,
    OBJECT_STORAGE_PROVIDER: storageProvider,
    LOCAL_STORAGE_DIR: localStorageDir,
    GRIDFS_BUCKET: gridfsBucket,
    R2_BUCKET: r2Bucket,
    R2_ACCOUNT_ID: r2AccountId,
    R2_ACCESS_KEY_ID: r2AccessKeyId,
    R2_SECRET_ACCESS_KEY: r2SecretAccessKey,
    FILE_MAX_SIZE: fileMaxSize,
    FILE_ALLOWED_MIME_TYPES: fileAllowedTypes,
    FILE_BLOCKED_MIME_TYPES: example.FILE_BLOCKED_MIME_TYPES ?? "",
    FILE_BLOCKED_EXTENSIONS: example.FILE_BLOCKED_EXTENSIONS ?? "",
    FIREBASE_CLIENT_EMAIL: firebaseClientEmail,
    FIREBASE_PRIVATE_KEY: firebasePrivateKey,
    FIREBASE_API_KEY: firebaseApiKey,
    FIREBASE_AUTH_DOMAIN: firebaseAuthDomain,
    FIREBASE_PROJECT_ID: firebaseProjectId,
    FIREBASE_STORAGE_BUCKET: firebaseStorageBucket,
    FIREBASE_MESSAGING_SENDER_ID: firebaseMessagingSenderId,
    FIREBASE_APP_ID: firebaseAppId,
    FIREBASE_VAPID_KEY: firebaseVapidKey,
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

  // host は D1/Prisma 前提のため Mongo 設定は不要
  const domain = opts.domain ??
    promptIfNeeded(
      "ACTIVITYPUB_DOMAIN (root domain)",
      example.ACTIVITYPUB_DOMAIN ?? "",
      opts.yes,
    );
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
  const terms = promptIfNeeded(
    "TERMS_FILE (任意)",
    example.TERMS_FILE ?? "",
    opts.yes,
  );

  // サーバー設定
  const serverHost = promptIfNeeded(
    "SERVER_HOST (空欄で0.0.0.0)",
    example.SERVER_HOST ?? "",
    opts.yes,
  );
  const serverPort = promptIfNeeded(
    "SERVER_PORT",
    example.SERVER_PORT ?? "80",
    opts.yes,
  );
  const useHttps = promptYesNo("HTTPSを使用しますか?", opts.yes);
  let serverCert = example.SERVER_CERT ?? "";
  let serverKey = example.SERVER_KEY ?? "";
  if (useHttps) {
    serverCert = promptIfNeeded("SERVER_CERT (証明書内容)", "", opts.yes);
    serverKey = promptIfNeeded("SERVER_KEY (秘密鍵内容)", "", opts.yes);
  }

  // SMTP設定
  const useSmtp = promptYesNo("メール送信(SMTP)を使用しますか?", opts.yes);
  let smtpHost = example.SMTP_HOST ?? "smtp.gmail.com";
  let smtpPort = example.SMTP_PORT ?? "465";
  let smtpUser = example.SMTP_USER ?? "";
  let smtpPass = example.SMTP_PASS ?? "";
  let smtpSsl = example.SMTP_SSL ?? "465";
  let mailFrom = example.MAIL_FROM ?? "";

  if (useSmtp) {
    smtpHost = promptIfNeeded("SMTP_HOST", smtpHost, opts.yes);
    smtpPort = promptIfNeeded("SMTP_PORT", smtpPort, opts.yes);
    smtpUser = promptIfNeeded("SMTP_USER", "", opts.yes);
    if (smtpUser && !validateEmail(smtpUser)) {
      console.warn("⚠️ 警告: SMTP_USERの形式が正しくない可能性があります");
    }
    smtpPass = promptIfNeeded("SMTP_PASS", "", opts.yes);
    smtpSsl = promptIfNeeded("SMTP_SSL (465=SSL, 587=TLS)", smtpSsl, opts.yes);
    mailFrom = promptIfNeeded(
      "MAIL_FROM (空欄でSMTP_USERを使用)",
      "",
      opts.yes,
    );
    if (mailFrom && !validateEmail(mailFrom)) {
      console.warn("⚠️ 警告: MAIL_FROMの形式が正しくない可能性があります");
    }
  }

  // FCM設定
  const useFcm = promptYesNo(
    "Firebase Cloud Messagingを使用しますか?",
    opts.yes,
  );
  let firebaseClientEmail = example.FIREBASE_CLIENT_EMAIL ?? "";
  let firebasePrivateKey = example.FIREBASE_PRIVATE_KEY ?? "";
  let firebaseApiKey = example.FIREBASE_API_KEY ?? "";
  let firebaseAuthDomain = example.FIREBASE_AUTH_DOMAIN ?? "";
  let firebaseProjectId = example.FIREBASE_PROJECT_ID ?? "";
  let firebaseStorageBucket = example.FIREBASE_STORAGE_BUCKET ?? "";
  let firebaseMessagingSenderId = example.FIREBASE_MESSAGING_SENDER_ID ?? "";
  let firebaseAppId = example.FIREBASE_APP_ID ?? "";
  let firebaseVapidKey = example.FIREBASE_VAPID_KEY ?? "";

  if (useFcm) {
    firebaseClientEmail = promptIfNeeded("FIREBASE_CLIENT_EMAIL", "", opts.yes);
    if (firebaseClientEmail && !validateEmail(firebaseClientEmail)) {
      console.warn(
        "⚠️ 警告: FIREBASE_CLIENT_EMAILの形式が正しくない可能性があります",
      );
    }
    firebasePrivateKey = promptIfNeeded("FIREBASE_PRIVATE_KEY", "", opts.yes);
    firebaseApiKey = promptIfNeeded("FIREBASE_API_KEY", "", opts.yes);
    firebaseAuthDomain = promptIfNeeded("FIREBASE_AUTH_DOMAIN", "", opts.yes);
    if (firebaseAuthDomain && !validateDomain(firebaseAuthDomain)) {
      console.warn(
        "⚠️ 警告: FIREBASE_AUTH_DOMAINの形式が正しくない可能性があります",
      );
    }
    firebaseProjectId = promptIfNeeded("FIREBASE_PROJECT_ID", "", opts.yes);
    firebaseStorageBucket = promptIfNeeded(
      "FIREBASE_STORAGE_BUCKET",
      "",
      opts.yes,
    );
    firebaseMessagingSenderId = promptIfNeeded(
      "FIREBASE_MESSAGING_SENDER_ID",
      "",
      opts.yes,
    );
    firebaseAppId = promptIfNeeded("FIREBASE_APP_ID", "", opts.yes);
    firebaseVapidKey = promptIfNeeded("FIREBASE_VAPID_KEY", "", opts.yes);
  }

  const env: Record<string, string> = {
    ...example,
  // host は Mongo を使用しない
    SERVER_HOST: serverHost,
    SERVER_PORT: serverPort,
    SERVER_CERT: serverCert,
    SERVER_KEY: serverKey,
    ACTIVITYPUB_DOMAIN: domain,
    FREE_PLAN_LIMIT: freeLimit,
    RESERVED_SUBDOMAINS: reserved,
    TERMS_FILE: terms,
    SMTP_HOST: smtpHost,
    SMTP_PORT: smtpPort,
    SMTP_USER: smtpUser,
    SMTP_PASS: smtpPass,
    SMTP_SSL: smtpSsl,
    MAIL_FROM: mailFrom,
    FIREBASE_CLIENT_EMAIL: firebaseClientEmail,
    FIREBASE_PRIVATE_KEY: firebasePrivateKey,
    FIREBASE_API_KEY: firebaseApiKey,
    FIREBASE_AUTH_DOMAIN: firebaseAuthDomain,
    FIREBASE_PROJECT_ID: firebaseProjectId,
    FIREBASE_STORAGE_BUCKET: firebaseStorageBucket,
    FIREBASE_MESSAGING_SENDER_ID: firebaseMessagingSenderId,
    FIREBASE_APP_ID: firebaseAppId,
    FIREBASE_VAPID_KEY: firebaseVapidKey,
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
    try {
      await Deno.stat(takosOut);
      existing.push("takos");
    } catch { /* ignore */ }
    try {
      await Deno.stat(hostOut);
      existing.push("host");
    } catch { /* ignore */ }
    if (existing.length) {
      if (opts.yes) {
        // 続行
      } else {
        const ans = prompt(
          `既に ${
            existing.join(",")
          } の .env が存在します。上書きしますか? [y/N]`,
        )?.toLowerCase() ?? "n";
        if (ans !== "y") {
          console.log("キャンセルしました。");
          Deno.exit(0);
        }
      }
    }
  }

  const targets: Target[] = opts.target === "all"
    ? ["takos", "host"]
    : [opts.target];
  for (const t of targets) {
    if (t === "takos") await createTakosEnv(takosOut, opts);
    if (t === "host") await createHostEnv(hostOut, opts);
  }
  console.log("完了しました。");
}

if (import.meta.main) {
  await main();
}
