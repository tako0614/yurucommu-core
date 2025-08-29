import type { DataStore } from "../db/types.ts";

// FASP機能は凍結されています
export async function bootstrapDefaultFasp(
  _env: Record<string, string>,
  _domain: string,
  _db: DataStore,
): Promise<void> {
  // 凍結のため処理なし
}
