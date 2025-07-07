import { atom, useAtom } from "solid-jotai";
import { PopUpFrame } from "./SetUpFrame";
import { createEffect, createSignal } from "solid-js";
import {
  encryptIdentityKey,
  encryptShareSignKey,
  getAllIdentityKeys,
  getAllShareSignKeys,
  saveIdentityKey,
  saveShareSignKey,
} from "../../utils/storage/idb";
import { deviceKeyState } from "../../utils/state";
import {
  decryptDataDeviceKey,
  encryptDataDeviceKey,
  generateIdentityKey,
  generateShareSignKey,
  keyHash,
} from "@takos/takos-encrypt-ink";

import { FiCheckCircle, FiClock, FiKey, FiXCircle } from "solid-icons/fi";
import { TakosFetch } from "../../utils/TakosFetch";

export const shoowIdentityKeyPopUp = atom(false);

export function CreateIdentityKeyPopUp() {
  const [showIdentityKeyPopUp, setShowIdentityKeyPopUp] = useAtom(
    shoowIdentityKeyPopUp,
  );
  const [lastCreateIdentityKeyTime, setLastCreateIdentityKeyTime] =
    createSignal("");
  const [isCreating, setIsCreating] = createSignal(false);
  const [deviceKey] = useAtom(deviceKeyState);

  createEffect(async () => {
    const identityKey = await getAllIdentityKeys();
    const latestIdentityKey = identityKey.sort((a, b) =>
      b.timestamp - a.timestamp
    )[0];
    if (latestIdentityKey) {
      setLastCreateIdentityKeyTime(
        new Date(latestIdentityKey.timestamp).toLocaleString(),
      );
      return;
    }
    setLastCreateIdentityKeyTime("未作成");
  });

  async function handleCreateIdentityKey() {
    setIsCreating(true);
    try {
      const encryptedMasterKey = localStorage.getItem("masterKey");
      const sessionUUID = localStorage.getItem("sessionUUID");
      if (!encryptedMasterKey || !sessionUUID) {
        alert("必要な認証情報が見つかりません");
        return;
      }

      const deviceKeyVal = deviceKey();
      if (!deviceKeyVal) {
        alert("デバイスキーが見つかりません");
        return;
      }

      const masterKey = await decryptDataDeviceKey(
        deviceKeyVal,
        encryptedMasterKey,
      );
      if (!masterKey) {
        alert("マスターキーの復号化に失敗しました");
        return;
      }

      const identityKey = await generateIdentityKey(
        sessionUUID,
        JSON.parse(masterKey),
      );
      if (!identityKey) {
        alert("IdentityKeyの生成に失敗しました");
        return;
      }

      const res = await TakosFetch("/api/v2/keys/identityKey", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          identityKey: identityKey.publickKey,
          identityKeySign: identityKey.sign,
        }),
      });

      if (res.status !== 200) {
        alert("サーバーへの登録に失敗しました");
        return;
      }

      const encryptedIdentityKey = await encryptIdentityKey({
        deviceKey: deviceKeyVal,
        identityKey: {
          privateKey: identityKey.privateKey,
          publicKey: identityKey.publickKey,
          sign: identityKey.sign,
        },
      });
      await saveIdentityKey({
        key: await keyHash(identityKey.publickKey),
        encryptedKey: encryptedIdentityKey,
        timestamp: Date.now(),
      });

      setLastCreateIdentityKeyTime(new Date().toLocaleString());
      setShowIdentityKeyPopUp(false);
      alert("IdentityKeyを作成しました。");
    } catch (error) {
      console.error(error);
      if (error instanceof Error) {
        alert("エラーが発生しました: " + error.message);
      } else {
        alert("エラーが発生しました: " + String(error));
      }
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <>
      {showIdentityKeyPopUp() && (
        <div class="fixed z-50 w-full h-full bg-[rgba(0,0,0,0.3)] backdrop-blur-sm left-0 top-0 flex justify-center items-center p-3 md:pb-3 pb-[76px] transition-all duration-300">
          <div class="bg-white dark:bg-gray-800 rounded-lg shadow-md w-full max-w-md transform transition-all duration-300 scale-100 opacity-100">
            <div class="flex justify-between items-center border-b px-6 py-4 border-gray-200 dark:border-gray-700">
              <div class="flex items-center space-x-3">
                <div class="bg-gray-200 dark:bg-gray-700 p-2 rounded-lg">
                  <FiKey class="text-gray-700 dark:text-gray-300 text-xl" />
                </div>
                <h2 class="text-xl font-medium text-gray-800 dark:text-white">
                  IdentityKey作成
                </h2>
              </div>
              <button
                onClick={() => setShowIdentityKeyPopUp(false)}
                class="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-white transition-colors"
                aria-label="閉じる"
              >
                <FiXCircle class="text-xl" />
              </button>
            </div>
            <div class="p-6">
              <div class="mb-6">
                <div class="flex items-center mb-2 text-gray-700 dark:text-gray-300">
                  <FiClock class="mr-2" />
                  <p>最新のIdentityKeyの作成時期:</p>
                </div>
                <div class="p-3 bg-gray-50 dark:bg-gray-700 rounded-md text-gray-800 dark:text-gray-100 font-normal border border-gray-200 dark:border-gray-600">
                  {lastCreateIdentityKeyTime()}
                </div>
              </div>
              <div class="flex justify-end">
                <button
                  type="button"
                  onClick={handleCreateIdentityKey}
                  disabled={isCreating()}
                  class="bg-gray-700 hover:bg-gray-800 dark:bg-gray-600 dark:hover:bg-gray-500 text-white font-medium py-2 px-5 rounded-md transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {isCreating()
                    ? (
                      <>
                        <div class="animate-spin mr-2 h-4 w-4 border-2 border-white border-t-transparent rounded-full inline-block">
                        </div>
                        処理中...
                      </>
                    )
                    : (
                      <>
                        <FiCheckCircle class="mr-2 inline-block" />
                        作成
                      </>
                    )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export const showShareSignKeyPopUp = atom(false);

export function CreateShareSignKeyPopUp() {
  const [showPopUp, setShowPopUp] = useAtom(showShareSignKeyPopUp);
  const [lastCreateTime, setLastCreateTime] = createSignal("");
  const [isCreating, setIsCreating] = createSignal(false);
  const [deviceKey] = useAtom(deviceKeyState);

  createEffect(async () => {
    const signKeys = await getAllShareSignKeys();
    const latestKey = signKeys.sort((a, b) => b.timestamp - a.timestamp)[0];

    if (latestKey) {
      setLastCreateTime(
        new Date(latestKey.timestamp).toLocaleString(),
      );
      return;
    }
    setLastCreateTime("未作成");
  });

  async function handleCreateShareSignKey() {
    setIsCreating(true);
    const masterKey = localStorage.getItem("masterKey");
    const sessionUUID = localStorage.getItem("sessionUUID");
    const deviceKeyVal = deviceKey();
    if (!masterKey || !sessionUUID || !deviceKeyVal) {
      alert("必要な認証情報が見つかりません");
      return;
    }
    const decryptedMasterKey = await decryptDataDeviceKey(
      deviceKeyVal,
      masterKey,
    );
    if (!decryptedMasterKey) {
      alert("マスターキーの復号化に失敗しました");
      return;
    }
    const shareSignKey = await generateShareSignKey(
      JSON.parse(decryptedMasterKey),
      sessionUUID,
    );
    if (!shareSignKey) {
      alert("ShareSignKeyの生成に失敗しました");
      return;
    }
    const res = await TakosFetch("/api/v2/keys/shareSignKey", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        shareSignKey: shareSignKey.publickKey,
        shareSignKeySign: shareSignKey.sign,
      }),
    });
    if (res.status !== 200) {
      alert("サーバーへの登録に失敗しました");
      return;
    }
    const encryptedShareSignKey = await encryptShareSignKey({
      deviceKey: deviceKeyVal,
      shareSignKey: {
        privateKey: shareSignKey.privateKey,
        publicKey: shareSignKey.publickKey,
        sign: shareSignKey.sign,
      },
    });
    await saveShareSignKey({
      key: await keyHash(shareSignKey.publickKey),
      encryptedKey: encryptedShareSignKey,
      timestamp: Date.now(),
    });
    setLastCreateTime(new Date().toLocaleString());
    setShowPopUp(false);
    alert("ShareSignKeyを作成しました");
  }

  return (
    <>
      {showPopUp() && (
        <div class="fixed z-50 w-full h-full bg-[rgba(0,0,0,0.3)] backdrop-blur-sm left-0 top-0 flex justify-center items-center p-3 md:pb-3 pb-[76px] transition-all duration-300">
          <div class="bg-white dark:bg-gray-800 rounded-lg shadow-md w-full max-w-md transform transition-all duration-300 scale-100 opacity-100">
            <div class="flex justify-between items-center border-b px-6 py-4 border-gray-200 dark:border-gray-700">
              <div class="flex items-center space-x-3">
                <div class="bg-gray-200 dark:bg-gray-700 p-2 rounded-lg">
                  <FiKey class="text-gray-700 dark:text-gray-300 text-xl" />
                </div>
                <h2 class="text-xl font-medium text-gray-800 dark:text-white">
                  ShareSignKey作成
                </h2>
              </div>
              <button
                onClick={() => setShowPopUp(false)}
                class="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-white transition-colors"
                aria-label="閉じる"
              >
                <FiXCircle class="text-xl" />
              </button>
            </div>
            <div class="p-6">
              <div class="mb-6">
                <div class="flex items-center mb-2 text-gray-700 dark:text-gray-300">
                  <FiClock class="mr-2" />
                  <p>最新のShareSignKeyの作成時期:</p>
                </div>
                <div class="p-3 bg-gray-50 dark:bg-gray-700 rounded-md text-gray-800 dark:text-gray-100 font-normal border border-gray-200 dark:border-gray-600">
                  {lastCreateTime()}
                </div>
              </div>
              <div class="flex justify-end">
                <button
                  type="button"
                  onClick={handleCreateShareSignKey}
                  disabled={isCreating()}
                  class="bg-gray-700 hover:bg-gray-800 dark:bg-gray-600 dark:hover:bg-gray-500 text-white font-medium py-2 px-5 rounded-md transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {isCreating()
                    ? (
                      <>
                        <div class="animate-spin mr-2 h-4 w-4 border-2 border-white border-t-transparent rounded-full inline-block">
                        </div>
                        処理中...
                      </>
                    )
                    : (
                      <>
                        <FiCheckCircle class="mr-2 inline-block" />
                        作成
                      </>
                    )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
