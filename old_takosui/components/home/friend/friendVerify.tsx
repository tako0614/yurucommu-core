import { decryptDataDeviceKey, keyHash } from "@takos/takos-encrypt-ink";
import hash from "fnv1a";
import { useAtom, useAtomValue } from "solid-jotai";
import { createSignal, onMount } from "solid-js";
import { deviceKeyState } from "../../../utils/state";
import { homeSelectedAtom } from "../home";
import { friendDetailId, setEncrypted } from "./friend";
import { TakosFetch } from "../../../utils/TakosFetch";
import { saveAllowKey } from "../../../utils/storage/idb";

export function FriendVerify() {
  const [selected, setSelected] = useAtom(homeSelectedAtom);
  const [keys, setKeys] = createSignal<[string, string]>(["", ""]);
  const deviceKey = useAtomValue(deviceKeyState);

  onMount(async () => {
    const friendId = friendDetailId();
    if (!friendId) return;

    const encryptedMasterKey = localStorage.getItem("masterKey");
    const deviceKeyS = deviceKey();
    if (!encryptedMasterKey || !deviceKeyS) return;

    const decryptedMasterKey = await decryptDataDeviceKey(
      deviceKeyS,
      encryptedMasterKey,
    );
    if (!decryptedMasterKey) return;

    const friendMasterKeyRes = await TakosFetch(
      `https://${
        friendId.split("@")[1]
      }/_takos/v1/key/masterKey?userId=${friendId}`,
    );
    const friendMasterKeyData = await friendMasterKeyRes.json();
    const friendMasterKey = friendMasterKeyData.key;
    setKeys([JSON.parse(decryptedMasterKey).publicKey, friendMasterKey]);
  });

  const handleVerify = async () => {
    const friendId = friendDetailId();
    if (!friendId) return;
    const hashKey = await keyHash(keys()[1]);
    await saveAllowKey({
      userId: friendId,
      latest: true,
      key: hashKey,
      timestamp: new Date().getTime(),
    });

    // 検証済みリストを更新
    setEncrypted((prev) => [...prev, friendId]);

    alert("鍵の検証が完了しました");
    setSelected("friend:detail"); // 詳細画面に戻る
  };

  return (
    <>
      <div class="flex items-center justify-between p-4">
        <button
          class="text-blue-400 hover:text-blue-300 transition-colors"
          onClick={() => setSelected("friend:detail")}
        >
          戻る
        </button>
        <h2 class="font-bold text-xl">鍵の検証</h2>
        <div class="w-10"></div> {/* バランス用の空要素 */}
      </div>

      <div class="p-4">
        <div class="p-4 bg-gray-800/70 border border-gray-700 rounded-lg space-y-6">
          <div>
            <p class="mb-2 font-medium text-blue-300">あなたのハッシュ</p>
            <p class="break-all bg-gray-900/80 p-3 rounded-lg border border-gray-700 font-mono text-green-400 text-sm">
              {hash(keys()[0]) || "読み込み中..."}
            </p>
          </div>

          <div>
            <p class="mb-2 font-medium text-blue-300">友だちのハッシュ</p>
            <p class="break-all bg-gray-900/80 p-3 rounded-lg border border-gray-700 font-mono text-green-400 text-sm">
              {hash(keys()[1]) || "読み込み中..."}
            </p>
          </div>

          <div class="border-t border-gray-700 pt-4">
            <p class="text-sm text-gray-300 mb-4">
              両方のハッシュが一致していることを確認してから、鍵を承認してください。
              別の通信手段で相手のハッシュを確認することをお勧めします。
            </p>

            <button
              onClick={handleVerify}
              class="w-full p-3 bg-green-600 hover:bg-green-700 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
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
                  d="M5 13l4 4L19 7"
                />
              </svg>
              鍵を承認する
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
