import { atom, useAtom, useAtomValue, useSetAtom } from "solid-jotai";
import { PopUpFrame, PopUpTitle } from "../utils/popUpFrame";
import {
  migrateKeyPublicState,
  migrateRequestPage,
  migrateSessionid,
  migrateSignKeyPrivateState,
  migrateSignKeyPublicState,
} from "../../utils/migrateState";
import {
  decryptDataDeviceKey,
  encryptDataMigrateKey,
  generateMigrateSignKey,
  keyHash,
  signDataMigrateSignKey,
} from "@takos/takos-encrypt-ink";
import { createSignal } from "solid-js";
import fnv1a from "fnv1a";
import { deviceKeyState } from "../../utils/state";
import { getAllAccountKeys, getAllAllowKeys } from "../../utils/storage/idb";
import { TakosFetch } from "../../utils/TakosFetch";
export const migrateRequestState = atom<boolean>(false);
const [migrateRequestInput, setMigrateRequestInput] = createSignal(false);

export function MigrateKey() {
  const [migrateRequest, setMigrateRequest] = useAtom(migrateRequestState);
  const [migrateSignKeyPrivate, setMigrateSignKeyPrivate] = useAtom(
    migrateSignKeyPrivateState,
  );
  const setMigrateSignKeyPublic = useSetAtom(migrateSignKeyPublicState);
  const [migrateKeyPublic, setMigrateKeyPublic] = useAtom(
    migrateKeyPublicState,
  );
  const [migrateSessioonId, setMigrateSessioonId] = useAtom(migrateSessionid);
  const migrateSignKeyPublic = useAtomValue(migrateSignKeyPublicState);
  const [value, setValue] = createSignal("");
  const deviceKey = useAtomValue(deviceKeyState);
  return (
    <>
      {migrateRequest() && (
        <PopUpFrame closeScript={setMigrateRequest}>
          <PopUpTitle>
            マイグレーション
          </PopUpTitle>
          <div>
            <p class="text-white">
              他のセッションが鍵のマイグレーションをリクエストしています。
              マイグレーションを許可しますか？
            </p>
            <div class="flex gap-2">
              <button
                onClick={async () => {
                  const migrateSignKey = generateMigrateSignKey();
                  setMigrateSignKeyPrivate(migrateSignKey.privateKey);
                  setMigrateSignKeyPublic(migrateSignKey.publickKey);
                  console.log(migrateSessioonId());
                  const res = await TakosFetch(
                    "/api/v2/sessions/encrypt/accept",
                    {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                      },
                      body: JSON.stringify({
                        migrateid: migrateSessioonId(),
                        migrateSignKey: migrateSignKey.publickKey,
                      }),
                    },
                  );
                  if (res.status !== 200) {
                    alert("エラーが発生しました。");
                  }
                  setMigrateRequest(false);
                  setMigrateRequestInput(true);
                }}
                class="bg-blue-600 hover:bg-blue-800 text-white font-bold py-2 px-6 rounded transition-colors duration-200"
              >
                マイグレーション
              </button>
              <button
                onClick={() => {
                  setMigrateSessioonId("");
                  setMigrateKeyPublic("");
                  setMigrateRequest(false);
                }}
                class="bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-2 px-6 rounded transition-colors duration-200"
              >
                キャンセル
              </button>
            </div>
          </div>
        </PopUpFrame>
      )}
      {migrateRequestInput() && (
        <PopUpFrame
          closeScript={setMigrateRequestInput}
        >
          <PopUpTitle>
            マイグレーション
          </PopUpTitle>
          {/*相手のデバイスに表示されている数字を入力するフォーム*/}
          <div>
            <p class="text-white">
              相手のデバイスに表示されている数字を入力してください。
            </p>
            <input
              type="text"
              class="bg-gray-100 p-2 rounded text-black"
              onChange={(e) => {
                setValue(e.target.value);
              }}
            />
            <button
              onClick={async () => {
                const migratekey = migrateKeyPublic();
                const migrateSignKey = migrateSignKeyPublic();
                if (!migratekey || !migrateSignKey) return "";
                if (fnv1a(migratekey + migrateSignKey) !== Number(value())) {
                  alert("入力された数字が正しくありません。");
                }
                console.log("1");
                const deviceKeyS = deviceKey();
                if (!deviceKeyS) return "";
                const encryptedAccountKyes = await getAllAccountKeys();
                const accountKeys = [];
                console.log("2");
                for (const accountKey of encryptedAccountKyes) {
                  const decryptedAccountKey = await decryptDataDeviceKey(
                    deviceKeyS,
                    accountKey.encryptedKey,
                  );
                  console.log("3");
                  if (!decryptedAccountKey) return "";
                  accountKeys.push({
                    key: accountKey.key,
                    rawKey: decryptedAccountKey,
                    timestamp: accountKey.timestamp,
                  });
                }
                const allowKeys = await getAllAllowKeys();
                const encryptedMasterKey = localStorage.getItem("masterKey");
                const masterKey = await decryptDataDeviceKey(
                  deviceKeyS,
                  encryptedMasterKey!,
                );
                const migrateData = JSON.stringify({
                  accountKeys,
                  allowKeys,
                  masterKey,
                });
                const encryptedMigrateData = await encryptDataMigrateKey(
                  migratekey,
                  migrateData,
                );
                const migrateSignKeyPriv = migrateSignKeyPrivate();
                const sign = signDataMigrateSignKey(
                  migrateSignKeyPriv,
                  encryptedMigrateData!,
                  await keyHash(migrateSignKey),
                );
                if (!sign) return "";
                const res = await TakosFetch("/api/v2/sessions/encrypt/send", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    migrateid: migrateSessioonId(),
                    data: encryptedMigrateData,
                    sign,
                  }),
                });
                if (res.status !== 200) {
                  alert("エラーが発生しました。");
                }
                console.log("4");
                setMigrateRequestInput(false);
                setMigrateSessioonId("");
                setMigrateKeyPublic("");
                setMigrateSignKeyPrivate("");
                setMigrateSignKeyPublic("");
                setValue("");
              }}
              class="bg-blue-600 hover:bg-blue-800 text-white font-bold py-2 px-6 rounded transition-colors duration-200"
            >
              マイグレーション
            </button>
          </div>
        </PopUpFrame>
      )}
    </>
  );
}
