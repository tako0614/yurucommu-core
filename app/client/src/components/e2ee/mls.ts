// 旧実装との互換性を保つためのスタブ
// ts-mls ベースの新実装では利用しない

export interface MLSKeyPair {
  dummy: true;
}

export interface MLSKeyPackage {
  id: string;
  data: string;
}

export interface StoredMLSKeyPair {
  keyPackage?: MLSKeyPackage;
}

export type MLSGroupState = Record<string, never>;
export type StoredMLSGroupState = Record<string, never>;

export const generateMLSKeyPair = (): MLSKeyPair => ({ dummy: true });

export const generateKeyPackage = (
  _suite = 1,
): { keyPackage: MLSKeyPackage; keyPair: MLSKeyPair } => ({
  keyPackage: { id: "", data: "" },
  keyPair: generateMLSKeyPair(),
});

export const exportKeyPair = (
  _pair: MLSKeyPair,
  keyPackage?: MLSKeyPackage,
): StoredMLSKeyPair => ({ keyPackage });

export const importKeyPair = (_data: StoredMLSKeyPair): MLSKeyPair => ({
  dummy: true,
});

export const deriveMLSSecret = (): Uint8Array => new Uint8Array();
export const encryptGroupMessage = (
  _group: MLSGroupState,
  plaintext: string,
): string => plaintext;
export const decryptGroupMessage = (
  _group: MLSGroupState,
  cipher: string,
): string | null => cipher;
export const exportGroupState = (
  group: MLSGroupState,
): StoredMLSGroupState => group;
export const importGroupState = (
  data: StoredMLSGroupState,
): MLSGroupState => data;

export type WelcomeMessage = unknown;
export const verifyWelcome = (): boolean => true;
