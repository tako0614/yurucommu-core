import { atom, useAtom, useAtomValue } from "solid-jotai";

import {
  descriptionState,
  iconState,
  nicknameState,
  talkListState,
} from "../../utils/state";
import { createEffect, createSignal } from "solid-js";
import { TakosFetchingUsersState } from "../sidebar/SideBar";
import { TakosFetchMultipleEntityInfo } from "../../utils/chache/Icon";

export const homeSelectedAtom = atom<
  | null
  | string
  | "settings:profile"
  | "settings:keys"
  | "settings:account"
  | "friend:detail"
  | "friend:verify"
>(null);
import { AccountManagement } from "./AccountManagement";
import { KeyManagement } from "./keyManagement";
import { Settings } from "./setting/Setting";
import { ProfileSettings } from "./setting/profile";
import { FriendVerify } from "./friend/friendVerify";
import { Friends } from "./friend/friend";
import { FriendDetail } from "./friend/detail";
import { AddUserUI } from "./AddFriend";
import { userId } from "../../utils/userId";
export function Home() {
  const [selected, setSelected] = useAtom(homeSelectedAtom);
  const nickName = useAtomValue(nicknameState);
  const icon = useAtomValue(iconState);
  const description = useAtomValue(descriptionState);
  const [talkList] = useAtom(talkListState);
  const [exampleFriendName, setExampleFriendName] = createSignal("");
  const [exampleFriendIcon, setExampleFriendIcon] = createSignal("");
  const [exampleGroupIcon, setExampleGroupIcon] = createSignal("");
  const [exampleGroupName, setExampleGroupName] = createSignal("");
  const [TakosFetchingUsers, setTakosFetchingUsers] = useAtom(
    TakosFetchingUsersState,
  );
  createEffect(async () => {
    const friends = [];
    const groups = [];
    for (const talk of talkList()!) {
      if (talk.type === "friend") {
        const match = talk.roomid.match(/^m\{([^}]+)\}@(.+)$/);
        if (!match) {
          continue;
        }
        const friendUserName = match[1];
        const domainFromRoom = match[2];
        friends.push(friendUserName + "@" + domainFromRoom);
      } else {
        const match = talk.roomid.match(/^g\{([^}]+)\}@(.+)$/);
        if (!match) {
          continue;
        }
        const groupName = match[1];
        const domainFromRoom = match[2];
        groups.push(groupName + "@" + domainFromRoom);
      }
      // 最大3つまで取得するよう変更
      if (friends.length >= 3 && groups.length >= 3) {
        break;
      }
    }

    // 友達情報の取得と表示
    if (friends.length > 0) {
      const displayFriends = friends.slice(0, 3);
      try {
        // Icon.tsを使って友達情報を一括取得
        const friendsInfoMap = await TakosFetchMultipleEntityInfo(
          displayFriends,
        );

        // 友達の名前をカンマ区切りで設定
        const friendNames = Array.from(friendsInfoMap.values()).map((info) =>
          info.nickName
        );
        setExampleFriendName(friendNames.join(", "));

        // 最初の友達のアイコン設定
        if (
          displayFriends.length > 0 && friendsInfoMap.has(displayFriends[0])
        ) {
          const firstFriendInfo = friendsInfoMap.get(displayFriends[0]);
          setExampleFriendIcon(
            firstFriendInfo?.icon.replace("data:image/png;base64,", "") || "",
          );
        }
      } catch (error) {
        console.error("Error TakosFetching friend info:", error);
      }
    }

    // グループ情報の取得と表示
    if (groups.length > 0) {
      const displayGroups = groups.slice(0, 3);
      try {
        // Icon.tsを使ってグループ情報を一括取得
        const groupsInfoMap = await TakosFetchMultipleEntityInfo(displayGroups);

        // グループの名前をカンマ区切りで設定
        const groupNames = Array.from(groupsInfoMap.values()).map((info) =>
          info.nickName
        );
        setExampleGroupName(groupNames.join(", "));

        // 最初のグループのアイコン設定
        if (displayGroups.length > 0 && groupsInfoMap.has(displayGroups[0])) {
          const firstGroupInfo = groupsInfoMap.get(displayGroups[0]);
          setExampleGroupIcon(
            firstGroupInfo?.icon.replace("data:image/png;base64,", "") || "",
          );
        }
      } catch (error) {
        console.error("Error TakosFetching group info:", error);
      }
    }
  });
  return (
    <>
      {selected() === null && (
        <>
          <div class="flex items-center justify-between p-4">
            <div class="text-xs">
            </div>
            <div class="flex items-center space-x-4">
              <span
                class="text-gray-400 cursor-pointer hover:text-white"
                onClick={() => setSelected("settings")} // ここを変更
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  class="w-6 h-6"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                  />
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
              </span>
              <span
                class="text-gray-400 cursor-pointer hover:text-white"
                onClick={() => setSelected("addUser")}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  class="w-6 h-6"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
                  />
                </svg>
              </span>
            </div>
          </div>
          <div class="p-4">
            <div class="flex items-center space-x-4">
              <div class="w-12 h-12 rounded-full flex items-center justify-center">
                <img
                  src={"data:image/jpg;base64," + icon()}
                  alt="Profile"
                  class="rounded-full"
                />
              </div>
              <div>
                <h1 class="text-2xl font-bold">{nickName()}</h1>
                <p class="text-sm">{description()}</p>
                <p class="text-sm text-green-400">{userId}</p>
              </div>
            </div>
          </div>
          <div class="p-4">
            <div class="mb-4">
              <input
                type="text"
                placeholder="検索"
                class="w-full p-2 bg-gray-800 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <h2 class="text-xl font-bold mb-2">友だちリスト</h2>
              <div class="space-y-2">
                <div
                  class="flex items-center space-x-2"
                  onClick={() => {
                    setSelected("friends");
                  }}
                >
                  <img
                    src={exampleFriendIcon()
                      ? "data:image/png;base64," + exampleFriendIcon()
                      : ""}
                    alt=""
                    class="w-10 h-10 rounded-full"
                  />
                  <div>
                    <p class="text-sm">友だち</p>
                    <p class="text-xs text-gray-400">{exampleFriendName()}</p>
                  </div>
                </div>
                <div class="flex items-center space-x-2">
                  <img
                    src={exampleGroupIcon()
                      ? "data:image/png;base64," + exampleGroupIcon()
                      : ""}
                    alt="グループ"
                    class="w-10 h-10 rounded-full"
                  />
                  <div>
                    <p class="text-sm">グループ</p>
                    <p class="text-xs text-gray-400">{exampleGroupName()}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
      {selected() == "friends" && <Friends />}
      {selected() === "addUser" && <AddUserUI />}
      {selected() === "settings" && <Settings />}
      {selected() === "settings:profile" && <ProfileSettings />}
      {selected() === "settings:keys" && <KeyManagement />}
      {selected() === "settings:account" && <AccountManagement />}
      {selected() === "friend:detail" && <FriendDetail />}
      {selected() === "friend:verify" && <FriendVerify />}
    </>
  );
}
