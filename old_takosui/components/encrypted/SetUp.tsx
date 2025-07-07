import {
  deviceKeyState,
  domainState,
  sessionidState,
  setUpState,
} from "../../utils/state.ts";
import { useAtom, useSetAtom } from "solid-jotai";
import { PopUpFrame } from "./SetUpFrame.tsx";
import { createEffect, createSignal } from "solid-js";
import { arrayBufferToBase64 } from "../../utils/buffers.ts";
import {
  encryptAccountKey,
  saveAccountKey,
  saveShareKey,
} from "../../utils/storage/idb.ts";
import {
  encryptDataDeviceKey,
  generateAccountKey,
  generateMasterKey,
  generateShareKey,
  keyHash,
} from "@takos/takos-encrypt-ink";
import { TakosFetch } from "../../utils/TakosFetch.ts";

export function SetUp() {
  const [setUp, setSetUp] = useAtom(setUpState);
  const [isOpen, setIsOpen] = createSignal(false);
  const [setted, setSetted] = createSignal(false);

  const [nickname, setNickname] = createSignal("");
  const [birthday, setBirthday] = createSignal("");
  const [icon, setIcon] = createSignal<File | null>(null);
  const [domain] = useAtom(domainState);
  const [sessionid] = useAtom(sessionidState);
  const [deviceKey] = useAtom(deviceKeyState);
  createEffect(() => {
    if (!setUp() && !setted()) {
      console.log(setUp());
      setIsOpen(true);
      setSetUp(true);
    }
  });
  return (
    <>
      {isOpen() && (
        <PopUpFrame closeScript={setIsOpen}>
          <div class="h-full w-full flex items-center justify-center">
            <div class="max-w-md w-full px-6">
              <h1 class="text-2xl font-semibold text-center mb-6">
                セットアップ
              </h1>
              <form
                class="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  const deviceKeyS = deviceKey();
                  if (!deviceKeyS) {
                    throw new Error("sessionid or deviceKey is not found");
                  }
                  if (nickname() && birthday() && icon()) {
                    console.log("submit");
                    // FileをarrayBufferに変換
                    const file = icon();
                    const reader = new FileReader();
                    reader.onload = async () => {
                      const arrayBuffer = reader.result as ArrayBuffer;
                      const base64 = arrayBufferToBase64(arrayBuffer);
                      const masterKey = generateMasterKey();
                      const sessionUUID = localStorage.getItem("sessionUUID");
                      if (!sessionUUID) {
                        throw new Error("sessionUUID is not found");
                      }
                      const accountKey = await generateAccountKey(
                        {
                          privateKey: masterKey.privateKey,
                          publicKey: masterKey.publicKey,
                        },
                      );
                      const sharekey = await generateShareKey(
                        masterKey.privateKey,
                        sessionUUID,
                      );
                      if (!accountKey || !sharekey) {
                        throw new Error(
                          "accountKey or sharekey is not generated",
                        );
                      }
                      const resp = await TakosFetch("/api/v2/sessions/setUp", {
                        method: "POST",
                        headers: {
                          "Content-Type": "application/json",
                        },
                        body: JSON.stringify({
                          masterKey: masterKey.publicKey,
                          accountKey: accountKey.publickKey,
                          accountKeySign: accountKey.sign,
                          nickName: nickname(),
                          icon: base64,
                          shareKey: sharekey.publickKey,
                          shareKeySign: sharekey.sign,
                        }),
                      });
                      if (resp.status !== 200) {
                        alert("エラーが発生しました");
                        return;
                      }
                      const encryptedMasterKey = await encryptDataDeviceKey(
                        deviceKeyS,
                        JSON.stringify(masterKey),
                      );
                      const encryptedAccountKey = await encryptAccountKey(
                        {
                          deviceKey: deviceKeyS,
                          accountKey: {
                            privateKey: accountKey.privateKey,
                            publicKey: accountKey.publickKey,
                            sign: accountKey.sign,
                          },
                        },
                      );
                      const encryptedShareKey = await encryptDataDeviceKey(
                        deviceKeyS,
                        sharekey.privateKey,
                      );
                      if (
                        !encryptedMasterKey ||
                        !encryptedAccountKey || !encryptedShareKey
                      ) throw new Error("encrypted key is not generated");
                      localStorage.setItem("masterKey", encryptedMasterKey);
                      await saveAccountKey({
                        key: await keyHash(accountKey.publickKey),
                        encryptedKey: encryptedAccountKey,
                        timestamp: JSON.parse(accountKey.publickKey).timestamp,
                      });
                      await saveShareKey({
                        key: await keyHash(sharekey.publickKey),
                        encryptedKey: encryptedShareKey,
                        timestamp: JSON.parse(sharekey.publickKey).timestamp,
                      });
                      setSetted(true);
                      setIsOpen(false);
                      alert("セットアップが完了しました");
                    };
                    reader.readAsArrayBuffer(file!);
                  }
                }}
              >
                <div>
                  <label class="block text-white mb-1">ニックネーム</label>
                  <input
                    type="text"
                    class="block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-black"
                    placeholder="ニックネームを入力してください"
                    value={nickname()}
                    onInput={(e) => setNickname(e.currentTarget.value)}
                  />
                </div>
                <div>
                  <label class="block text-white mb-1">誕生日</label>
                  <input
                    type="date"
                    class="block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-black"
                    value={birthday()}
                    onInput={(e) => setBirthday(e.currentTarget.value)}
                  />
                </div>
                <div>
                  <label class="block text-white mb-1">アイコン</label>
                  <input
                    type="file"
                    class="block w-full text-white"
                    onChange={(e) => {
                      const files = e.currentTarget.files;
                      if (files && files.length > 0) {
                        setIcon(files[0]);
                      }
                    }}
                  />
                </div>
                <button
                  type="submit"
                  class="w-full mt-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  送信
                </button>
              </form>
            </div>
          </div>
        </PopUpFrame>
      )}
    </>
  );
}
