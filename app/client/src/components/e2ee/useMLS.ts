import { createSignal } from "solid-js";
import { addKeyPackage } from "./api.ts";
import { generateKeyPair } from "./mls_wrapper.ts";

export function useMLS(userName: string) {
  const [status, setStatus] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  const generateKeys = async () => {
    try {
      setStatus("鍵を生成中...");
      setError(null);
      const kp = await generateKeyPair(userName);
      await addKeyPackage(userName, { content: kp.encoded });
      setStatus("鍵を生成しました");
    } catch (err) {
      console.error("鍵生成に失敗しました", err);
      setStatus(null);
      setError("鍵生成に失敗しました");
    }
  };

  return { generateKeys, status, error };
}
