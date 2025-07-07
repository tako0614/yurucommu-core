import { useAtom, useAtomValue, useSetAtom } from "solid-jotai";
import {
  deviceKeyState,
  domainState,
  loadState,
  sessionidState,
  webSocketState,
} from "./state";
import { createEffect, createRoot } from "solid-js";
import {
  migrateKeyPrivateState,
  migrateKeyPublicState,
  migrateRequestPage,
  migrateSessionid,
  migrateSignKeyPublicState,
} from "./migrateState.ts";

import { messageListState, messageValueState } from "../utils/state.ts";
import { selectedRoomState } from "./room/roomState.ts";

import { migrateRequestState } from "../components/encrypted/MigrateKeys.tsx";
import {
  decryptDataMigrateKey,
  encryptDataDeviceKey,
  generateShareKey,
  keyHash,
  verifyDataMigrateSignKey,
} from "@takos/takos-encrypt-ink";
import { getTauriSessionId, TakosFetch } from "./TakosFetch.ts";
import { saveAccountKey, saveAllowKey, saveShareKey } from "./storage/idb.ts";
import { callState } from "../components/Call/index.tsx";

declare global {
  interface Window {
    isApp?: boolean;
    serverEndpoint?: string;
  }
}

export function createWebsocket(loadedFn: () => void) {
  createRoot(() => {
    const selectedRoom = useAtomValue(selectedRoomState);
    const setWebsocket = useSetAtom(webSocketState);
    const setMigrateRequest = useSetAtom(migrateRequestState);
    const setMessageList = useSetAtom(messageListState);
    const setLoad = useSetAtom(loadState);
    const [migrateSessioonId, setMigrateSessioonId] = useAtom(migrateSessionid);
    const setMigrateKeyPublic = useSetAtom(migrateKeyPublicState);
    const [migrateSignKeyPublic, setMigrateSignKeyPublic] = useAtom(
      migrateSignKeyPublicState,
    );
    const setPage = useSetAtom(migrateRequestPage);
    const migrateKeyPrivate = useAtomValue(migrateKeyPrivateState);
    const deviceKey = useAtomValue(deviceKeyState);
    const [call, setCall] = useAtom(callState);

    // 再接続関連の変数
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 10;
    let reconnectTimeout: number | null = null;

    // WebSocketを接続する関数
    const connectWebSocket = async () => {
      const protocol = "wss:";
      const host = window.serverEndpoint;
      let websocket;

      if (window.isApp) {
        const sessionid = await getTauriSessionId();
        websocket = new WebSocket(
          `${protocol}//${host}/api/v2/ws?sessionid=${sessionid}`,
        );
      } else {
        websocket = new WebSocket(
          `${protocol}//${host}/api/v2/ws`,
        );
      }

      websocket.onopen = () => {
        setWebsocket(websocket);
        loadedFn();
        reconnectAttempts = 0; // 接続成功したらカウンターをリセット
        console.log("WebSocket接続成功");
      };

      websocket.onclose = () => {
        setLoad(false);
        // 再接続ロジック
        if (reconnectAttempts < maxReconnectAttempts) {
          // 指数バックオフによる待機時間の計算（最大30秒）
          const timeout = Math.min(
            1000 * Math.pow(2, reconnectAttempts),
            30000,
          );
          console.log(`WebSocket切断。${timeout / 1000}秒後に再接続します...`);

          if (reconnectTimeout) {
            clearTimeout(reconnectTimeout);
          }

          reconnectTimeout = setTimeout(() => {
            reconnectAttempts++;
            connectWebSocket();
          }, timeout) as unknown as number;
        } else {
          console.error(
            "最大再接続回数に達しました。ページを更新してください。",
          );
        }
      };

      websocket.onerror = (error) => {
        console.error("WebSocketエラー:", error);
      };

      websocket.onmessage = async (event) => {
        const data = JSON.parse(event.data);
        console.log(data);
        switch (data.type) {
          case "message": {
            const messageData = JSON.parse(data.data);
            if (selectedRoom()?.roomid === messageData.roomid) {
              setMessageList((prev) => [...prev, messageData]);
            }
            break;
          }
          case "migrateRequest": {
            const data2: { migrateid: string; migrateKey: string } = JSON.parse(
              data.data,
            );
            if (data2.migrateid === migrateSessioonId()) {
              return;
            }
            setMigrateRequest(true);
            setMigrateSessioonId(data2.migrateid);
            setMigrateKeyPublic(data2.migrateKey);
            break;
          }
          case "migrateAccept": {
            const data2: { migrateid: string; migrateSignKey: string } = JSON
              .parse(
                data.data,
              );
            if (data2.migrateid === migrateSessioonId()) {
              setMigrateSignKeyPublic(data2.migrateSignKey);
              setPage(3);
            }
            break;
          }
          case "migrateData": {
            const data2: {
              migrateid: string;
              data: string;
              sign: string;
            } = JSON.parse(data.data);
            if (data2.migrateid === migrateSessioonId()) {
              const migrateKey = migrateKeyPrivate();
              const migrateSignKey = migrateSignKeyPublic();
              if (!migrateKey || !migrateSignKey) {
                return;
              }
              const verify = verifyDataMigrateSignKey(
                migrateSignKey,
                data2.sign,
                data2.data,
              );
              if (!verify) {
                return;
              }
              const decryptData = await decryptDataMigrateKey(
                migrateKey,
                data2.data,
              );
              const decryptDataJson: {
                masterKey: string;
                accountKeys: {
                  key: string;
                  rawKey: string;
                  timestamp: number;
                }[];
                allowKeys: {
                  key: string;
                  latest: boolean;
                  timestamp: number;
                  userId: string;
                }[];
              } = JSON.parse(decryptData!);
              const deviceKeyS = deviceKey();
              if (!deviceKeyS) {
                return;
              }
              const encryptedMasterKey = await encryptDataDeviceKey(
                deviceKeyS,
                decryptDataJson.masterKey,
              );
              const encryptedAccountKeys: {
                key: string; //hash
                encryptedKey: string;
                timestamp: number;
              }[] = [];
              for (const accountKey of decryptDataJson.accountKeys) {
                console.log(accountKey);
                const encryptedKey = await encryptDataDeviceKey(
                  deviceKeyS,
                  accountKey.rawKey,
                );
                if (!encryptedKey) continue;
                encryptedAccountKeys.push({
                  key: accountKey.key,
                  encryptedKey,
                  timestamp: accountKey.timestamp,
                });
              }
              if (!encryptedMasterKey) return;
              const shareKey = await generateShareKey(
                JSON.parse(decryptDataJson.masterKey).privateKey,
                localStorage.getItem("sessionUUID")!,
              );
              if (!shareKey) return;
              const res = await TakosFetch("/api/v2/sessions/encrypt/success", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  shareKey: shareKey.publickKey,
                  shareKeySign: shareKey.sign,
                }),
              });
              if (res.status !== 200) {
                return;
              }
              const encryptedShareKey = await encryptDataDeviceKey(
                deviceKeyS,
                shareKey.privateKey,
              );
              await saveShareKey({
                key: await keyHash(shareKey.publickKey),
                encryptedKey: encryptedShareKey!,
                timestamp: JSON.parse(shareKey.publickKey).timestamp,
              });
              localStorage.setItem("masterKey", encryptedMasterKey);
              for (const accountKey of encryptedAccountKeys) {
                await saveAccountKey(accountKey);
              }
              for (const allowKey of decryptDataJson.allowKeys) {
                await saveAllowKey(allowKey);
              }
              alert("Migrate Success");
              window.location.reload();
            }
            break;
          }
          case "callRequest": {
            // 着信処理
            const callData = JSON.parse(data.data);
            console.log("着信:", callData);
            if (call()) {
              // 通話中の場合は着信を無視
              return;
            }
            // 着信音を再生（オプション）
            const audio = new Audio("/sounds/call-incoming.mp3");
            audio.loop = true;
            audio.play().catch((err) =>
              console.error("着信音の再生に失敗:", err)
            );
            console.log("callData", callData);
            // callStateを更新して着信画面を表示
            setCall({
              type: callData.type,
              mode: callData.mode, // または callData.mode に基づいて設定
              friendId: callData.userId,
              isEncrypted: false, // 必要に応じて調整
              status: "incoming",
              _audioRef: audio,
              isCaller: false,
            });
            break;
          }
          case "callAccept": {
            // 通話応答処理
            const acceptData = JSON.parse(data.data);
            console.log("通話応答:", acceptData);

            // callStateを更新して通話中状態に変更
            setCall((prev) => {
              // 着信音を停止
              if (prev && prev._audioRef) {
                prev._audioRef.pause();
                prev._audioRef.currentTime = 0;
              }

              return prev
                ? {
                  ...prev,
                  status: "connected",
                  token: acceptData.token,
                }
                : null;
            });
            // MediaSoupクライアントの初期化は audio.tsx の createEffect で行われるため削除
            break;
          }
        }
      };
    };

    createEffect(() => {
      // 最初の接続を開始
      connectWebSocket();
    });
  });
}
