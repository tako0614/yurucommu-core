import type { RosterEvidence } from "./mls_wrapper.ts";

export type BindingStatus = "Verified" | "BoundOnly" | "Unbound";

/**
 * Evidence と Credential の一致状況からバインディング状態を判定する
 */
export function evaluateBinding(
  credentialActor: string | undefined,
  leafSignatureKeyFpr: string,
  evidences: RosterEvidence[],
): BindingStatus {
  const ev = evidences.find((e) =>
    e.leafSignatureKeyFpr === leafSignatureKeyFpr
  );
  if (!ev) return "Unbound";
  return credentialActor === ev.actor ? "Verified" : "BoundOnly";
}

/**
 * 判定結果に応じて表示用ラベルと注意文言を返す
 */
export function bindingMessage(
  status: BindingStatus,
): { label: string; caution?: string } {
  switch (status) {
    case "Verified":
      return { label: "検証済み" };
    case "BoundOnly":
      return {
        label: "バインドのみ",
        caution: "鍵の出所はサーバ経由。指紋確認で検証可",
      };
    default:
      return {
        label: "未リンクの端末",
        caution: "指紋の確認を推奨します",
      };
  }
}
