import { dirname, fromFileUrl, join } from "@std/path";
import { loadConfig } from "../shared/config.ts";
import { getEnvPath } from "../shared/args.ts";

/**
 * takos host 全体で利用するベース環境変数オブジェクトを生成するモジュール。
 * 役割:
 *  - .env の読み込み場所を CLI 引数で上書き可能にする
 *  - Firebase / Adsense / FASP 関連キーを一元管理
 *  - 今後キーが増えても配列を追加するだけで済むように整理
 */

// 追加 / 変更しやすいようにカテゴリ別のキー配列を定義
const FIREBASE_KEYS = [
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
  "FIREBASE_API_KEY",
  "FIREBASE_AUTH_DOMAIN",
  "FIREBASE_PROJECT_ID",
  "FIREBASE_STORAGE_BUCKET",
  "FIREBASE_MESSAGING_SENDER_ID",
  "FIREBASE_APP_ID",
  "FIREBASE_VAPID_KEY",
] as const;

const ADSENSE_KEYS = [
  "ADSENSE_CLIENT",
  "ADSENSE_SLOT",
  "ADSENSE_ACCOUNT",
] as const;

const FASP_KEYS = [
  "FASP_DEFAULT_BASE_URL",
  "FASP_SERVER_DISABLED",
] as const;

// コマンドライン引数から .env のパスを取得
const envPath = getEnvPath();
const defaultEnvPath = join(dirname(fromFileUrl(import.meta.url)), ".env");
const hostEnv = await loadConfig({ envPath: envPath ?? defaultEnvPath });

type KeyTuple = readonly string[];

function copyKeys(src: Record<string, string>, keys: KeyTuple): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) {
    if (src[k] !== undefined) out[k] = src[k];
  }
  return out;
}

// ベースとなる固定値
const base: Record<string, string> = {
  DB_MODE: "host",
  MONGO_URI: hostEnv["MONGO_URI"],
  ROOT_DOMAIN: hostEnv["ROOT_DOMAIN"] ?? "",
  hashedPassword: "", // 後続で設定される想定
  salt: "", // 後続で設定される想定
  ACTIVITYPUB_DOMAIN: "", // テナント or root ごとに差し替え
  host: hostEnv["ROOT_DOMAIN"] ? `https://${hostEnv["ROOT_DOMAIN"]}` : "",
  OAUTH_CLIENT_ID: "",
  OAUTH_CLIENT_SECRET: "",
  OBJECT_STORAGE_PROVIDER: "gridfs",
  LOCAL_STORAGE_DIR: "uploads",
  GRIDFS_BUCKET: "uploads",
};

// カテゴリ別キーを集約
const dynamicKeys = {
  ...copyKeys(hostEnv, FIREBASE_KEYS),
  ...copyKeys(hostEnv, ADSENSE_KEYS),
  ...copyKeys(hostEnv, FASP_KEYS),
};

// 既存コード互換のため従来どおり Record<string,string> をエクスポート
export const takosEnv: Record<string, string> = {
  ...base,
  ...dynamicKeys,
};

// （必要なら）キー一覧を外部で流用できるようにオプションで公開
export const TAKOS_ENV_KEY_GROUPS = {
  FIREBASE_KEYS,
  ADSENSE_KEYS,
  FASP_KEYS,
};
