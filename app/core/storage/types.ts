/**
 * オブジェクトストレージの抽象インターフェース（実装は core から分離）
 */

export interface ObjectStorage {
  put(key: string, data: Uint8Array): Promise<string>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}

