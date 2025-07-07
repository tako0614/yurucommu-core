import {
  deviceKeyState,
  domainState,
  EncryptedSessionState,
  IdentityKeyAndAccountKeyState,
  sessionidState,
  setUpState,
} from "../../utils/state";
import {
  migrateKeyPrivateState,
  migrateKeyPublicState,
  migrateRequestPage,
  migrateSessionid,
  migrateSignKeyPrivateState,
  migrateSignKeyPublicState,
  showMigrateRequest,
} from "../../utils/migrateState";
import { atom, useAtom, useSetAtom } from "solid-jotai";
import { PopUpFrame } from "./SetUpFrame";
import { createEffect, createSignal } from "solid-js";
import fnv1a from "fnv1a";
import {
  encryptAccountKey,
  saveAccountKey,
  saveShareKey,
} from "../../utils/storage/idb";
import {
  decryptDataDeviceKey,
  encryptDataDeviceKey,
  encryptDataMigrateKey,
  generateAccountKey,
  generateIdentityKey,
  generateMasterKey,
  generateMigrateKey,
  generateMigrateSignKey,
  generateShareKey,
  generateShareSignKey,
  keyHash,
  signDataMigrateSignKey,
} from "@takos/takos-encrypt-ink";
import { TakosFetch } from "../../utils/TakosFetch";

export function EncryptSession() {
  const [EncryptedSession, setEncryptedSession] = useAtom(
    EncryptedSessionState,
  );
  const [setUp, setSetUp] = useAtom(setUpState);
  const [isOpen, setIsOpen] = createSignal(false);
  const [setted, setSetted] = createSignal(false);
  const [page, setPage] = useAtom(migrateRequestPage);
  const [deivceKey] = useAtom(deviceKeyState);
  const [domain] = useAtom(domainState);
  const [migrateKeyPublic, setMigrateKeyPublic] = useAtom(
    migrateKeyPublicState,
  );
  const [migrateKeyPrivate, setMigrateKeyPrivate] = useAtom(
    migrateKeyPrivateState,
  );
  const [migrateSignKeyPublic, setMigrateSignKeyPublic] = useAtom(
    migrateSignKeyPublicState,
  );
  const [migrateSignKeyPrivate, setMigrateSignKeyPrivate] = useAtom(
    migrateSignKeyPrivateState,
  );
  const [migrateSession, setMigrateSession] = useAtom(migrateSessionid);
  const [sessionid] = useAtom(sessionidState);
  const [deviceKey] = useAtom(deviceKeyState);
  const [encryptedSession, setEncryptedSessionState] = useAtom(
    EncryptedSessionState,
  );
  createEffect(() => {
    if (!EncryptedSession() && !setted() && setUp() && !EncryptedSession()) {
      setIsOpen(true);
    } else {
      setIsOpen(false);
    }
  });
  return (
    <>
      {isOpen() && (
        <PopUpFrame closeScript={setIsOpen}>
          <div class="h-full w-full flex items-center justify-center">
            <div class="max-w-md w-full px-6">
              <h1 class="text-2xl font-semibold text-center mb-6">
                セッションの暗号化
              </h1>
              <div>
                {page() === 1 && (
                  <>
                    <div class="mb-4">
                      <button
                        class="w-full bg-blue-500 hover:bg-blue-600 text-white font-medium py-2 px-4 rounded-lg transition-colors duration-200"
                        onClick={async () => {
                          const migrateKey = generateMigrateKey();
                          setMigrateKeyPrivate(migrateKey.privateKey);
                          setMigrateKeyPublic(migrateKey.publickKey);
                          const res = await TakosFetch(
                            "/api/v2/sessions/encrypt/request",
                            {
                              method: "POST",
                              headers: {
                                "Content-Type": "application/json",
                              },
                              body: JSON.stringify({
                                migrateKey: migrateKey.publickKey,
                              }),
                            },
                          );
                          if (res.status === 200) {
                            setMigrateSession((await res.json()).migrateid);
                            setPage(2);
                          }
                        }}
                      >
                        既存のセッションから鍵をリクエスト
                      </button>
                    </div>
                    <div>
                      <button
                        class="w-full bg-green-500 hover:bg-green-600 text-white font-medium py-2 px-4 rounded-lg transition-colors duration-200"
                        onClick={async () => {
                          const masterKey = generateMasterKey();
                          const uuid = localStorage.getItem("sessionUUID");
                          if (!uuid) return;
                          const accountKey = await generateAccountKey(
                            masterKey,
                          );
                          const shareKey = await generateShareKey(
                            masterKey.privateKey,
                            uuid,
                          );

                          if (!accountKey || !shareKey) return;
                          const res = await TakosFetch(
                            "/api/v2/sessions/reset",
                            {
                              method: "POST",
                              headers: {
                                "Content-Type": "application/json",
                              },
                              body: JSON.stringify({
                                masterKey: masterKey.publicKey,
                                accountKey: accountKey.publickKey,
                                accountKeySign: accountKey.sign,
                                shareKey: shareKey.publickKey,
                                shareKeySign: shareKey.sign,
                              }),
                            },
                          );
                          if (res.status === 200) {
                            setEncryptedSessionState(true);
                            setSetted(true);
                            const deviceKeyS = deivceKey();
                            if (!deviceKeyS) return;
                            const encryptedMasterKey =
                              await encryptDataDeviceKey(
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
                            console.log(deviceKeyS);
                            console.log(encryptedAccountKey);
                            const encryptedShareKey =
                              await encryptDataDeviceKey(
                                deviceKeyS,
                                JSON.stringify(shareKey),
                              );
                            if (
                              !encryptedMasterKey ||
                              !encryptedAccountKey || !encryptedShareKey
                            ) return;
                            localStorage.setItem(
                              "masterKey",
                              encryptedMasterKey,
                            );
                            await saveAccountKey({
                              key: await keyHash(accountKey.publickKey),
                              encryptedKey: encryptedAccountKey,
                              timestamp:
                                JSON.parse(accountKey.publickKey).timestamp,
                            });
                            await saveShareKey({
                              key: await keyHash(shareKey.publickKey),
                              encryptedKey: encryptedShareKey,
                              timestamp:
                                JSON.parse(shareKey.publickKey).timestamp,
                            });
                            alert("鍵をリセットしました");
                          }
                        }}
                      >
                        新しい鍵を作成
                      </button>
                    </div>
                  </>
                )}
                {page() === 2 && (
                  <>
                    <div class="text-center">
                      認証済みのセッションから鍵をリクエストしました。
                      応答をお待ちください。
                    </div>
                  </>
                )}
                {page() === 3 && (
                  <>
                    <div>
                      {(() => {
                        const migratekey = migrateKeyPublic();
                        const migrateSignKey = migrateSignKeyPublic();
                        if (!migratekey || !migrateSignKey) return "";
                        return String(
                          "hash: " + fnv1a(migratekey + migrateSignKey),
                        );
                      })()}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </PopUpFrame>
      )}
    </>
  );
}
