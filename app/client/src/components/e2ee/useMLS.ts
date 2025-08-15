import { createSignal } from "solid-js";
import { addKeyPackage } from "./api.ts";
import { generateKeyPair } from "./mls_wrapper.ts";
import {
  bindingMessage,
  type BindingStatus,
  evaluateBinding,
} from "./binding.ts";
import { loadKeyPackageRecords, loadRosterEvidence } from "./storage.ts";

export function useMLS(userName: string) {
  const [status, setStatus] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [bindingStatus, setBindingStatus] = createSignal<BindingStatus | null>(
    null,
  );
  const [bindingInfo, setBindingInfo] = createSignal<
    { label: string; caution?: string } | null
  >(null);
  const [ktInfo, setKtInfo] = createSignal<{ included: boolean } | null>(null);

  const generateKeys = async () => {
    try {
      setStatus("鍵を生成中...");
      setError(null);
      // BasicCredential.identity に Actor の URL を設定する
      const actorId =
        new URL(`/users/${userName}`, globalThis.location.origin).href;
      const kp = await generateKeyPair(actorId);
      await addKeyPackage(userName, { content: kp.encoded });
      setStatus("鍵を生成しました");
    } catch (err) {
      console.error("鍵生成に失敗しました", err);
      setStatus(null);
      setError(
        err instanceof Error ? err.message : "鍵生成に失敗しました",
      );
    }
  };

  const assessBinding = async (
    accountId: string,
    roomId: string,
    credentialActor: string | undefined,
    leafSignatureKeyFpr: string,
    ktIncluded?: boolean,
  ) => {
    const evidences = await loadRosterEvidence(accountId, roomId);
    const result = evaluateBinding(
      credentialActor,
      leafSignatureKeyFpr,
      evidences,
    );
    setBindingStatus(result);
    setBindingInfo(bindingMessage(result));
    setKtInfo({ included: ktIncluded ?? false });
  };

  const assessMemberBinding = async (
    accountId: string,
    roomId: string,
    credentialActor: string | undefined,
    leafSignatureKeyFpr: string,
  ) => {
    const evidences = await loadRosterEvidence(accountId, roomId);
    const result = evaluateBinding(
      credentialActor,
      leafSignatureKeyFpr,
      evidences,
    );
    const records = await loadKeyPackageRecords(accountId, roomId);
    const rec = records.find((r) =>
      r.credentialFingerprint === leafSignatureKeyFpr &&
      (!credentialActor || r.actorId === credentialActor)
    );
    return {
      status: result,
      info: bindingMessage(result),
      kt: { included: rec?.ktIncluded ?? false },
    };
  };

  return {
    generateKeys,
    status,
    error,
    bindingStatus,
    bindingInfo,
    ktInfo,
    assessBinding,
    assessMemberBinding,
  };
}
