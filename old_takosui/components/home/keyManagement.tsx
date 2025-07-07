import {
  decryptDataDeviceKey,
  encryptDataShareKey,
  generateAccountKey,
  keyHash,
  signDataShareSignKey,
  verifyMasterKey,
} from "@takos/takos-encrypt-ink";
import hash from "fnv1a";
import { useAtom, useAtomValue, useSetAtom } from "solid-jotai";
import { createEffect, createSignal } from "solid-js";
import { deviceKeyState } from "../../utils/state";
import {
  decryptShareSignKey,
  encryptAccountKey,
  getAllAccountKeys,
  getAllShareSignKeys,
  saveAccountKey,
} from "../../utils/storage/idb";
import { showShareSignKeyPopUp } from "../encrypted/CreateIdentityKeyPopUp";
import { homeSelectedAtom } from "./home";
import { TakosFetch } from "../../utils/TakosFetch";

export function KeyManagement() {
  const deviceKey = useAtomValue(deviceKeyState);
  const setShowSHareSignKeyPopUp = useSetAtom(showShareSignKeyPopUp);
  const [masterKeyHash, setMasterKeyHash] = createSignal<string>("");
  const [latestKeyTimestamp, setLatestKeyTimestamp] = createSignal<Date | null>(
    null,
  );

  createEffect(async () => {
    // マスターキーのハッシュを取得する処理
    const encryptedMasterKey = localStorage.getItem("masterKey");
    const deviceKeyS = deviceKey();
    if (!encryptedMasterKey || !deviceKeyS) return;

    try {
      const decryptedMasterKey = await decryptDataDeviceKey(
        deviceKeyS,
        encryptedMasterKey,
      );
      if (!decryptedMasterKey) return;
      const parsedKey = JSON.parse(decryptedMasterKey);
      setMasterKeyHash(String(hash(parsedKey.publicKey)));
    } catch (error) {
      console.error("鍵の情報取得エラー:", error);
    }
    try {
      const accountKeys = await getAllAccountKeys();

      if (accountKeys && accountKeys.length > 0) {
        // タイムスタンプで降順ソート
        accountKeys.sort((a, b) => b.timestamp - a.timestamp);
        const latestKey = accountKeys[0];
        // タイムスタンプをDate型に変換して保存
        setLatestKeyTimestamp(new Date(latestKey.timestamp));
      }
    } catch (error) {
      console.error("アカウント鍵の取得エラー:", error);
    }
  });

  const regenerateKeys = () => {
    // 新しい鍵を生成する処理を実装
    if (confirm("新しい鍵を生成しますか？この操作は元に戻せません。")) {
      alert("新しい鍵を生成しました。");
      // ここで実際の鍵生成処理を実装
    }
  };

  const updateAccountKey = async () => {
    if (confirm("アカウント認証鍵を更新しますか？")) {
      const masterKey = localStorage.getItem("masterKey");
      if (!masterKey) {
        alert("マスターキーがありません");
        return;
      }
      const deviceKeyS = deviceKey();
      if (!deviceKeyS) {
        alert("デバイスキーがありません");
        return;
      }
      const decryptedMasterKey = await decryptDataDeviceKey(
        deviceKeyS,
        masterKey,
      );
      if (!decryptedMasterKey) {
        alert("マスターキーの復号に失敗しました");
        return;
      }
      const masterKeyPublic = JSON.parse(decryptedMasterKey).publicKey;
      const newAccountKey = await generateAccountKey(
        JSON.parse(decryptedMasterKey),
      );
      if (!newAccountKey) {
        alert("アカウント鍵の生成に失敗しました");
        return;
      }
      const sessions: {
        uuid: string;
        encrypted: string;
        userAgent: string;
        shareKey: string;
        shareKeySign: string;
      }[] = await TakosFetch("/api/v2/sessions/list").then((res) => res.json());
      if (!sessions) {
        alert("セッションの取得に失敗しました");
        return;
      }
      const shareData = JSON.stringify({
        privateKey: newAccountKey.privateKey,
        publicKey: newAccountKey.publickKey,
      });
      const latestShareSignKey = await getAllShareSignKeys();
      if (latestShareSignKey.length === 0) {
        setShowSHareSignKeyPopUp(true);
        return;
      }
      const shareSignKey = (latestShareSignKey.sort(
        (a, b) => b.timestamp - a.timestamp,
      ))[0].encryptedKey;
      const decryptedShareSignKey = await decryptShareSignKey({
        deviceKey: deviceKeyS,
        encryptedShareSignKey: shareSignKey,
      });
      const shareDataSign = signDataShareSignKey(
        decryptedShareSignKey.privateKey,
        shareData,
        await keyHash(decryptedShareSignKey.publicKey),
      );
      if (!shareDataSign) {
        alert("アカウント鍵の署名に失敗しました");
        return;
      }
      const encryptedAccountKeys = [];
      for (const session of sessions) {
        if (session.encrypted) {
          if (
            !verifyMasterKey(
              masterKeyPublic,
              session.shareKeySign,
              session.shareKey,
            )
          ) {
            alert("マスターキーの検証に失敗しました");
            return;
          }
          const encryptedAccountKey = await encryptDataShareKey(
            session.shareKey,
            shareData,
          );
          if (!encryptedAccountKey) {
            alert("アカウント鍵の暗号化に失敗しました");
            return;
          }
          encryptedAccountKeys.push([
            session.uuid,
            encryptedAccountKey,
          ]);
        }
      }
      const res = await TakosFetch("/api/v2/keys/accountKey", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          accountKey: newAccountKey.publickKey,
          accountKeySign: newAccountKey.sign,
          encryptedAccountKeys: encryptedAccountKeys,
          shareDataSign,
        }),
      });
      if (res.status !== 200) {
        alert("アカウント鍵の更新に失敗しました");
        return;
      }
      const encryptedAccountKey = await encryptAccountKey({
        deviceKey: deviceKeyS,
        accountKey: {
          privateKey: newAccountKey.privateKey,
          publicKey: newAccountKey.publickKey,
          sign: newAccountKey.sign,
        },
      });
      if (!encryptedAccountKey) {
        alert("アカウント鍵の暗号化に失敗しました");
        return;
      }
      await saveAccountKey({
        key: await keyHash(newAccountKey.publickKey),
        encryptedKey: encryptedAccountKey,
        timestamp: JSON.parse(newAccountKey.publickKey).timestamp,
      });
      alert("アカウント鍵を更新しました");
    }
  };

  // 日付をフォーマットする関数
  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  };
  const [selected, setSelected] = useAtom(homeSelectedAtom);
  return (
    <div class="p-4">
      <div class="flex items-center justify-between mb-5">
        <button
          class="text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1"
          onClick={() => setSelected("settings")}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M10 19l-7-7m0 0l7-7m-7 7h18"
            />
          </svg>
          戻る
        </button>
        <h3 class="text-lg font-bold">鍵の管理</h3>
        <div class="w-10"></div> {/* スペースバランス用 */}
      </div>

      {/* Master Key 情報 */}
      <div class="p-4 bg-gray-800/70 border border-gray-700 rounded-lg mb-2">
        <div class="flex items-center gap-3 mb-3">
          <span class="text-blue-400 bg-blue-500/10 p-2 rounded-lg">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
              />
            </svg>
          </span>
          <h4 class="font-medium">あなたの公開鍵ハッシュ</h4>
        </div>
        <div class="text-sm break-all bg-gray-900/80 p-3 rounded-lg border border-gray-700 font-mono text-green-400">
          {masterKeyHash() ||
            (
              <span class="flex items-center gap-2 justify-center text-gray-400">
                <svg
                  class="animate-spin h-4 w-4 text-white"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    class="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    stroke-width="4"
                  >
                  </circle>
                  <path
                    class="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  >
                  </path>
                </svg>
                鍵情報を読み込み中...
              </span>
            )}
        </div>
        <p class="text-xs text-gray-400 mt-3 flex items-center gap-1">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          この値は他の人と共有して、あなたの身元を確認するのに使用できます。
        </p>

        <button
          class="w-full p-2 mt-3 bg-red-600/80 hover:bg-red-700 rounded-lg transition-colors flex items-center justify-center gap-2 group text-sm"
          onClick={regenerateKeys}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-4 w-4 transition-transform group-hover:rotate-180"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          再生成
        </button>
      </div>

      {/* Account Key 情報 */}
      <div class="p-4 bg-gray-800/70 border border-gray-700 rounded-lg">
        <div class="flex items-center gap-3 mb-3">
          <span class="text-blue-400 bg-blue-500/10 p-2 rounded-lg">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
          </span>
          <h4 class="font-medium">アカウント認証鍵</h4>
        </div>
        <div class="text-sm bg-gray-900/80 p-3 rounded-lg border border-gray-700 text-gray-400 flex flex-col items-center justify-center">
          {latestKeyTimestamp()
            ? (
              <>
                <span class="text-center py-1 text-yellow-400">
                  最終生成日時: {formatDate(latestKeyTimestamp()!)}
                </span>
                <span class="text-center py-1 text-xs text-gray-500">
                  更新ボタンを押すと新しい鍵が生成されます
                </span>
              </>
            )
            : (
              <span class="text-center py-2">
                更新ボタンを押して、新しいアカウント認証鍵を生成してください。
              </span>
            )}
        </div>
        <p class="text-xs text-gray-400 mt-3 flex items-center gap-1">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          このアカウント認証鍵はサーバーへのログインに使用されます。
        </p>

        <button
          class="w-full p-2 mt-3 bg-blue-600/80 hover:bg-blue-700 rounded-lg transition-colors flex items-center justify-center gap-2 group text-sm"
          onClick={updateAccountKey}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          更新する
        </button>
      </div>

      <div class="border-t border-gray-700 pt-4 mt-4">
        <div class="text-xs text-red-400/80 bg-red-900/10 border border-red-900/20 p-3 rounded-lg">
          <p class="font-medium mb-1">⚠ 鍵の取り扱いに関する注意</p>
          <p>
            公開鍵を再生成すると、以前に検証した友だちとの暗号化チャットができなくなります。この操作は元に戻せません。
          </p>
        </div>
      </div>
    </div>
  );
}
