import { useAtom, useSetAtom } from "solid-jotai";
import {
  birthdayState,
  descriptionState,
  deviceKeyState,
  domainState,
  EncryptedSessionState,
  friendsState,
  iconState,
  IdentityKeyAndAccountKeyState,
  loadState,
  loginState,
  messageListState,
  nicknameState,
  notificationState,
  sessionidState,
  setUpState,
  talkListState,
  webSocketState,
} from "../utils/state";
import { createWebsocket } from "../utils/ws";
import {
  decryptDataDeviceKey,
  decryptDataShareKey,
  keyHash,
  verifyDataShareSignKey,
  verifyMasterKey,
} from "@takos/takos-encrypt-ink";
import {
  isSelectRoomState,
  nickNameState,
  roomKeyState,
  selectedChannelState,
  selectedRoomState,
} from "../utils/room/roomState";
import {
  createRoomSelector,
  GroupChannel,
  Room,
} from "../utils/room/roomUtils";
import { isLoadedMessageState } from "../components/talk/Content";
import { createEffect } from "solid-js";
import { groupChannelState } from "../components/sidebar/SideBar";
import { getMessage } from "../utils/message/getMessage";
import { TakosFetch } from "../utils/TakosFetch";
import { getShareKey, saveAccountKey } from "../utils/storage/idb";
import { userId } from "../utils/userId";

export function Loading() {
  return (
    <>
      <div class="w-full h-screen fixed z-[99999999999] flex bg-[#181818]">
        <div class="m-auto flex flex-col items-center">
          <div class="loader mb-4"></div>
          <div class="text-4xl text-center text-white">Loading...</div>
        </div>
      </div>
      <style>
        {`
        .loader {
          border: 8px solid rgba(255, 255, 255, 0.1);
          border-top: 8px solid #ffffff;
          border-radius: 50%;
          width: 50px;
          height: 50px;
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          0% {
            transform: rotate(0deg);
          }
          100% {
            transform: rotate(360deg);
          }
        }
      `}
      </style>
    </>
  );
}
export function Load() {
  const [load, setLoad] = useAtom(loadState);
  const [login, setLogin] = useAtom(loginState);
  const [domain] = useAtom(domainState);
  const [sessionid] = useAtom(sessionidState);
  const [setUp, setSetUp] = useAtom(setUpState);
  const [deviceKey, setDeviceKey] = useAtom(deviceKeyState);
  const setIconState = useSetAtom(iconState);
  const setnotificationState = useSetAtom(notificationState);
  const setTalkListState = useSetAtom(talkListState);
  const setEncryptedSession = useSetAtom(EncryptedSessionState);
  const setNickName = useSetAtom(nicknameState);
  const setIcon = useSetAtom(iconState);
  const setDiscription = useSetAtom(descriptionState);
  const setFriends = useSetAtom(friendsState);

  // ルーム選択のための状態
  const setRoomNickName = useSetAtom(nickNameState);
  const setSelectedRoom = useSetAtom(selectedRoomState);
  const setIsSelectRoom = useSetAtom(isSelectRoomState);
  const setMessageList = useSetAtom(messageListState);
  const setLoadedMessageList = useSetAtom(isLoadedMessageState);
  const setSelectedChannel = useSetAtom(selectedChannelState);
  const setGroupChannel = useSetAtom(groupChannelState);

  // URLからルームIDを取得する関数
  const getRoomIdFromPath = () => {
    const path = window.location.pathname;
    const segments = path.split("/").filter(Boolean);

    // URLパスが /talk/{roomId} の形式か確認
    if (segments.length >= 2 && segments[0] === "talk") {
      return decodeURIComponent(segments[1]); // URLデコードを追加
    }
    return null;
  };

  // ルーム選択関数を作成
  const selectRoom = createRoomSelector({
    setRoomNickName,
    setSelectedRoom,
    setIsSelectRoom,
    setMessageList,
    setLoadedMessageList,
    setSelectedChannel,
    setGroupChannel,
  });

  async function loadSession() {
    let sessionData;
    try {
      sessionData = await TakosFetch("/api/v2/sessions/status", {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });
    } catch (error) {
      setLogin(false);
      setLoad(true);
      return;
    }
    const session = await sessionData.json();
    if (!session) {
      setLogin(false);
      setLoad(true);
      console.log("session not found");
      return;
    }
    console.log("session");
    if (session.login) {
      console.log("uaaaaaaaaaaaaaaaaaaaaaaa", userId)
      setLogin(true);
      TakosFetch("/_takos/v1/user/" + userId + "/nickName", {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      }).then((res) => res.json())
        .then((data) => {
          if (data.nickName) {
            setNickName(data.nickName);
          }
        });
      TakosFetch("/_takos/v1/user/" + userId + "/description").then((res) =>
        res.json()
      )
        .then((data) => {
          if (data.description) {
            setDiscription(data.description);
          }
        });
      TakosFetch(`/_takos/v1/user/${userId}/icon`).then((res) => res.json())
        .then(
          (data) => {
            setIcon(data.icon);
          },
        );
    } else {
      console.log("not login1");
      setLogin(false);
      setLoad(true);
      console.log("not login2");
      return;
    }
    if (session.setup) {
      const icon = await TakosFetch(
        `/_takos/v1/user/${userId}/icon`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
      const iconData = await icon.json();
      setIconState(iconData.icon);
      setSetUp(true);
    } else {
      console.log("not setup1");
    }
    if (session.deviceKey) {
      console.log("deviceKey", session.deviceKey);
      setDeviceKey(session.deviceKey);
    }
    if (session.requests) {
      session.requests.forEach((request: any) => {
        setnotificationState((r) => [...r, {
          id: request.id,
          type: request.type,
          sender: request.sender,
          query: request.query,
          timestamp: request.timestamp,
        }]);
      });
    }
    const talkList: {
      timestamp: string;
      latestMessage: string;
      type: "group" | "friend";
      roomid: string;
    }[] = [];
    const friends: string[] = [];
    if (session.friendInfo) {
      for (const talk of session.friendInfo) {
        let latestMessage = "";
        if (talk[1]) {
          try {
            const latestMessageRaw = await getMessage({
              messageid: talk[1],
              type: "friend",
              roomId: talk[0],
              senderId: talk[2],
            });
            if (latestMessageRaw.value.type === "text") {
              latestMessage = JSON.parse(latestMessageRaw.value.content).text;
            } else {
              switch (latestMessageRaw.value.type) {
                case "image":
                  latestMessage = "画像";
                  break;
                case "video":
                  latestMessage = "動画";
                  break;
                case "audio":
                  latestMessage = "音声";
                  break;
                case "file":
                  latestMessage = "ファイル";
                  break;
                default:
                  latestMessage = "不明なメッセージ";
                  break;
              }
            }
          } catch (error) {
            latestMessage = "解読に失敗しました";
          }
        } else {
          latestMessage = "メッセージはありません";
        }
        //console.log("latestMessageRaw", latestMessageRaw);

        talkList.push({
          timestamp: "nodata",
          latestMessage,
          type: "friend",
          roomid: `m{${talk[0].split("@")[0]}}@${talk[0].split("@")[1]}`,
        });
        friends.push(talk[0]);
      }
    }
    if (session.encrypted) {
      setEncryptedSession(session.encrypted);
    } else {
      setEncryptedSession(false);
    }
    if (session.groupInfo) {
      for (const talk of session.groupInfo) {
        let latestMessage = "";
        if (talk[1]) {
          try {
            const latestMessageRaw = await getMessage({
              messageid: talk[1],
              type: "group", // グループの場合はこちら
              roomId: talk[0],
              senderId: talk[2],
            });
            if (latestMessageRaw.value.type === "text") {
              latestMessage = JSON.parse(latestMessageRaw.value.content).text;
            } else {
              switch (latestMessageRaw.value.type) {
                case "image":
                  latestMessage = "画像";
                  break;
                case "video":
                  latestMessage = "動画";
                  break;
                case "audio":
                  latestMessage = "音声";
                  break;
                case "file":
                  latestMessage = "ファイル";
                  break;
                default:
                  latestMessage = "不明なメッセージ";
                  break;
              }
            }
          } catch (error) {
            latestMessage = "解読に失敗しました";
          }
        } else {
          latestMessage = "メッセージはありません";
        }
        talkList.push({
          timestamp: "nodata",
          latestMessage,
          type: "group",
          roomid: `g{${talk[0].split("@")[0]}}@${talk[0].split("@")[1]}`,
        });
      }
    }
    if (session.updatedAccountKeys && session.updatedAccountKeys.length > 0) {
      for (const key of session.updatedAccountKeys) {
        await saveSharedAccountKey(key, session.deviceKey);
      }
    } else {
      console.log("no updatedAccountKeys");
    }
    setTalkListState(talkList);
    setFriends(friends);
    if (session.login) {
      createWebsocket(() => {
        setLoad(true);

        // URLからルームIDを取得して接続を試みる
        const roomIdFromPath = getRoomIdFromPath();
        if (roomIdFromPath) {
          // トークリストからマッチするルームを探す
          setTimeout(() => {
            // URLデコードされたルームIDとの比較
            const matchedRoom = talkList.find((room) =>
              room.roomid === roomIdFromPath
            );
            if (matchedRoom) {
              // ルームタイプに応じてニックネームを取得
              const getRoomNickName = async (
                roomid: string,
                type: "friend" | "group",
              ) => {
                try {
                  const match = roomid.match(
                    type === "friend"
                      ? /^m\{([^}]+)\}@(.+)$/
                      : /^g\{([^}]+)\}@(.+)$/,
                  );

                  if (!match) return roomid;

                  const name = match[1];
                  const domain = match[2];
                  const fullId = name + "@" + domain;

                  const endpoint = type === "friend"
                    ? `https://${domain}/_takos/v1/user/nickName/${fullId}`
                    : `https://${domain}/_takos/v1/group/name/${fullId}`;

                  const response = await TakosFetch(endpoint);
                  const data = await response.json();

                  return type === "friend" ? data.nickName : data.name;
                } catch (error) {
                  console.error("Error TakosFetching nickname:", error);
                  return roomid;
                }
              };
              getRoomNickName(matchedRoom.roomid, matchedRoom.type).then(
                (nickName) => {
                  selectRoom({
                    roomid: matchedRoom.roomid,
                    latestMessage: matchedRoom.latestMessage,
                    type: matchedRoom.type,
                    nickName,
                  });
                },
              );
            }
          }, 50); // talkListの処理完了を待つための小さな遅延
        }
      });
      return;
    } else {
      setLoad(true);
    }
  }

  loadSession();
  return <></>;
}

export async function saveSharedAccountKey(hash: string, deviceKey: string) {
  const sharedAccountKey = await TakosFetch(
    "/api/v2/keys/accountKey?hash=" + encodeURIComponent(hash),
  )
    .then((res) => res.json());
  if (!sharedAccountKey) {
    return;
  }
  const shareSingKeyHash = JSON.parse(sharedAccountKey.shareDataSign).keyHash;
  const shareDataSign = await TakosFetch(
    "/api/v2/keys/shareSignKey?hash=" + encodeURIComponent(shareSingKeyHash),
  ).then((res) => res.json());
  if (!shareDataSign) {
    return;
  }
  const decryptedMasterKey = await (async () => {
    const masterKey = localStorage.getItem("masterKey");
    if (!masterKey) {
      return;
    }
    const decryptedMasterKey = await decryptDataDeviceKey(
      deviceKey,
      masterKey,
    );
    if (
      !decryptedMasterKey
    ) {
      return;
    }
    return JSON.parse(decryptedMasterKey).publicKey;
  })();
  if (!decryptedMasterKey) {
    return;
  }
  if (
    !verifyMasterKey(
      decryptedMasterKey,
      shareDataSign.sign,
      shareDataSign.shareSignKey,
    )
  ) {
    return;
  }
  const shareKeyHash = JSON.parse(sharedAccountKey.accountKey).keyHash;
  const encshareKey = await getShareKey({ key: shareKeyHash });
  if (!encshareKey) {
    return;
  }
  const shareKey = await decryptDataDeviceKey(
    deviceKey,
    encshareKey.encryptedKey,
  );
  if (!shareKey) {
    return;
  }
  const accountKey = await decryptDataShareKey(
    shareKey,
    sharedAccountKey.accountKey,
  );
  if (!accountKey) {
    return;
  }
  if (
    !verifyDataShareSignKey(
      shareDataSign.shareSignKey,
      sharedAccountKey.shareDataSign,
      accountKey,
    )
  ) {
    console.log("verifyDataShareSignKey failed");
    return;
  }
  await saveAccountKey({
    key: await keyHash(JSON.parse(accountKey).publicKey),
    encryptedKey: accountKey,
    timestamp: (JSON.parse(JSON.parse(accountKey).publicKey)).timestamp,
  });
  await TakosFetch("/api/v2/keys/accountKey/notify", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      hash: await keyHash(JSON.parse(accountKey).publicKey),
    }),
  });
}
