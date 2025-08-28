import { extname } from "@std/path";

/**
 * 環境変数のファイルサイズ指定をバイト数に変換する。
 */
export function parseSizeToBytes(v?: string): number | undefined {
  if (!v) return undefined;
  const s = v.trim().toLowerCase();
  // 数値のみ: バイトとして解釈
  if (/^\d+$/.test(s)) return Number(s);
  const m = s.match(/^(\d+)(b|kb|mb|gb)?$/i);
  if (!m) return undefined;
  const n = Number(m[1]);
  const unit = (m[2] || "b").toLowerCase();
  switch (unit) {
    case "b":
      return n;
    case "kb":
      return n * 1024;
    case "mb":
      return n * 1024 * 1024;
    case "gb":
      return n * 1024 * 1024 * 1024;
    default:
      return undefined;
  }
}

function getListFromEnv(
  env: Record<string, string>,
  key: string,
): string[] | undefined {
  const raw = env[key];
  if (!raw) return undefined;
  return raw.split(",").map((x) => x.trim()).filter(Boolean);
}

/**
 * 環境変数からアップロード可能な最大ファイルサイズを取得する。
 */
export function getMaxFileSize(
  env: Record<string, string>,
): number | undefined {
  return parseSizeToBytes(env["FILE_MAX_SIZE"]);
}

/**
 * 許可された MIME タイプのリストを取得する。
 */
export function getAllowedMimeTypes(
  env: Record<string, string>,
): string[] | undefined {
  const list = getListFromEnv(env, "FILE_ALLOWED_MIME_TYPES");
  return (list && list.length > 0) ? list : undefined;
}

/**
 * ブロックされた MIME タイプのリストを取得する。
 */
export function getBlockedMimeTypes(
  env: Record<string, string>,
): string[] | undefined {
  const list = getListFromEnv(env, "FILE_BLOCKED_MIME_TYPES");
  return (list && list.length > 0) ? list : undefined;
}

/**
 * ブロックされた拡張子のリストを取得する。
 */
export function getBlockedExtensions(
  env: Record<string, string>,
): string[] | undefined {
  const list = getListFromEnv(env, "FILE_BLOCKED_EXTENSIONS");
  return (list && list.length > 0)
    ? list.map((x) => x.toLowerCase())
    : undefined;
}

/**
 * MIME タイプおよび拡張子が許可されているかを判定する。
 */
export function isAllowedFileType(
  mediaType: string,
  filename: string | undefined,
  env: Record<string, string>,
): boolean {
  const allowed = getAllowedMimeTypes(env);
  const blockedMime = getBlockedMimeTypes(env);
  const blockedExts = getBlockedExtensions(env);

  // 許可リストが設定されている場合のみ厳格チェック
  if (allowed && allowed.length > 0) {
    if (!allowed.includes(mediaType)) return false;
  }

  // MIME ブラックリスト
  if (blockedMime && blockedMime.length > 0) {
    if (blockedMime.includes(mediaType)) return false;
  }

  // 拡張子ブラックリスト
  if (filename && blockedExts && blockedExts.length > 0) {
    const ext = extname(filename).toLowerCase();
    if (blockedExts.includes(ext)) return false;
  }
  return true;
}
