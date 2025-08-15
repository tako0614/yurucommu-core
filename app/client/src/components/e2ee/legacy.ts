import type { GeneratedKeyPair, StoredGroupState } from "./mls_wrapper.ts";

// 旧実装との互換性を保つためのスタブ
// 新しい ts-mls 実装が整うまでの一時的な措置

export type MLSKeyPair = GeneratedKeyPair;
export type MLSGroupState = StoredGroupState;
export type StoredMLSKeyPair = GeneratedKeyPair;
export type StoredMLSGroupState = StoredGroupState;
export type WelcomeMessage = unknown;

export const generateMLSKeyPair = (): MLSKeyPair => ({
  public: {} as unknown,
  private: {} as unknown,
  encoded: "",
});

export const generateKeyPackage = (
  _suite = 1,
): { keyPackage: { id: string; data: string }; keyPair: MLSKeyPair } => ({
  keyPackage: { id: "", data: "" },
  keyPair: generateMLSKeyPair(),
});

export const exportKeyPair = (
  pair: MLSKeyPair,
): StoredMLSKeyPair => pair;

export const importKeyPair = (
  data: StoredMLSKeyPair,
): MLSKeyPair => data;

export const deriveMLSSecret = (): Promise<Uint8Array> =>
  Promise.resolve(new Uint8Array());

export const encryptGroupMessage = (
  _group: MLSGroupState,
  plaintext: string,
): string => plaintext;

export const decryptGroupMessage = (
  _group: MLSGroupState,
  cipher: string,
): Promise<string | null> => Promise.resolve(cipher);

export const exportGroupState = (
  group: MLSGroupState,
): StoredMLSGroupState => group;

export const importGroupState = (
  data: StoredMLSGroupState,
): Promise<MLSGroupState> => Promise.resolve(data);

export const verifyWelcome = (): Promise<boolean> => Promise.resolve(true);
