import { useAtom, useAtomValue, useSetAtom } from "solid-jotai";
import { openConfig } from "../Chat.tsx";
import {
  isSelectRoomState,
  selectedRoomState,
} from "../../utils/room/roomState.ts";
import { createEffect, createSignal, For, Show } from "solid-js";
import { groupChannelState } from "../sidebar/SideBar.tsx";
// 新しく作成した外部ステートをインポート
import {
  bannedUsersState,
  editMemberState,
  friendListState,
  groupDescriptionState,
  groupIconState,
  groupIsPrivateState,
  groupNameState,
  isLoadingBanListState,
  isLoadingRequestsState,
  joinRequestsState,
  pendingMemberRolesState,
  roleColorState,
  roleIdState,
  roleNameState,
  rolePermissionsState,
  selectedNewRoleState,
  selectedTabState,
  showAddRoleState,
  showBanConfirmState,
  showCreateRoleState,
  showDeleteRoleConfirmState,
  showEditRoleState,
  showKickConfirmState,
  showTimeoutModalState,
  timeoutDurationState,
  updatedGroupDescriptionState,
  updatedGroupIconState,
  updatedGroupIsPrivateState,
  updatedGroupNameState,
} from "../../utils/room/settingRoomState.ts";
import { GroupSetting } from "./Group/Group.tsx";
import { FriendSetting } from "./Friends/Friend.tsx";
import { TakosFetch } from "../../utils/TakosFetch.ts";

export function SettingRoom() {
  const [showGroupPopUp, setShowGroupPopUp] = useAtom(openConfig);
  const [isSelectRoom] = useAtom(isSelectRoomState);
  const [selectedRoom] = useAtom(selectedRoomState);
  const selected = useAtomValue(selectedTabState);
  const setFriendList = useSetAtom(friendListState);
  const groupChannel = useAtomValue(groupChannelState);
  const editMember = useAtomValue(editMemberState);
  const setJoinRequests = useSetAtom(joinRequestsState);
  const setIsLoadingRequests = useSetAtom(
    isLoadingRequestsState,
  );
  const setBannedUsers = useSetAtom(bannedUsersState);
  const setIsLoadingBanList = useSetAtom(
    isLoadingBanListState,
  );
  const setGroupName = useSetAtom(groupNameState);
  const setGroupDescription = useSetAtom(
    groupDescriptionState,
  );
  const setGroupIcon = useSetAtom(groupIconState);
  const setGroupIsPrivate = useSetAtom(groupIsPrivateState);
  const setUpdatedGroupName = useSetAtom(
    updatedGroupNameState,
  );
  const setUpdatedGroupDescription = useSetAtom(
    updatedGroupDescriptionState,
  );
  const setUpdatedGroupIcon = useSetAtom(
    updatedGroupIconState,
  );
  const setUpdatedGroupIsPrivate = useSetAtom(
    updatedGroupIsPrivateState,
  );
  const setPendingMemberRoles = useSetAtom(
    pendingMemberRolesState,
  );
  const [isMobile, setIsMobile] = createSignal(window.innerWidth <= 768);

  // 画面サイズの変更を検知
  createEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  });

  createEffect(() => {
    if (editMember()) {
      const member = groupChannel()?.members.find(
        (m) => m.userId === editMember(),
      );
      if (member) {
        setPendingMemberRoles([...member.role]);
      }
    }
  });
  createEffect(() => {
    if (selected() === "invite") {
      async function getFriendList() {
        const res = await (await TakosFetch("/api/v2/friend/list", {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        })).json();
        setFriendList(res);
      }
      getFriendList();
    }
  });
  createEffect(() => {
    if (selected() === "request") {
      const TakosFetchJoinRequests = async () => {
        setIsLoadingRequests(true);
        const match = selectedRoom()?.roomid.match(/^g\{([^}]+)\}@(.+)$/);
        if (!match) {
          setIsLoadingRequests(false);
          return;
        }
        try {
          const res = await TakosFetch(
            `https://${match[2]}/_takos/v1/group/requests/${
              match[1] + "@" + match[2]
            }`,
          );
          if (res.ok) {
            const data = await res.json();
            setJoinRequests(data.requests || []);
          }
        } catch (error) {
          console.error("参加リクエストの取得に失敗しました", error);
        } finally {
          setIsLoadingRequests(false);
        }
      };

      TakosFetchJoinRequests();
    }
  });
  createEffect(() => {
    if (selected() === "ban") {
      const TakosFetchBannedUsers = async () => {
        setIsLoadingBanList(true);
        const match = selectedRoom()?.roomid.match(/^g\{([^}]+)\}@(.+)$/);
        if (!match) {
          setIsLoadingBanList(false);
          return;
        }

        try {
          const res = await TakosFetch(
            `https://${match[2]}/_takos/v1/group/bans/${match[1]}@${match[2]}`,
          );

          if (res.ok) {
            const data = await res.json();
            setBannedUsers(data.bans || []);
          }
        } catch (error) {
          console.error("BANリストの取得に失敗しました", error);
        } finally {
          setIsLoadingBanList(false);
        }
      };

      TakosFetchBannedUsers();
    }
  });
  createEffect(async () => {
    if (selected() === "detail") {
      const roomid = selectedRoom()?.roomid;
      if (!roomid) {
        return;
      }
      const match = roomid.match(/^g\{([^}]+)\}@(.+)$/);
      if (!match) {
        return;
      }
      const friendUserName = match[1];
      const domainFromRoom = match[2];
      const icon = (await (await TakosFetch(
        `https://${domainFromRoom}/_takos/v1/group/icon/${
          friendUserName + "@" + domainFromRoom
        }`,
      )).json()).icon;
      setGroupIcon(icon);
      const nickName = (await (await TakosFetch(
        `https://${domainFromRoom}/_takos/v1/group/name/${
          friendUserName + "@" + domainFromRoom
        }`,
      )).json()).name;
      const description = (await (await TakosFetch(
        `https://${domainFromRoom}/_takos/v1/group/description/${
          friendUserName + "@" + domainFromRoom
        }`,
      )).json()).description;
      const allowJoin = (await (await TakosFetch(
        `https://${domainFromRoom}/_takos/v1/group/allowJoin/${
          friendUserName + "@" + domainFromRoom
        }`,
      )).json()).allowJoin;
      setGroupName(nickName);
      setGroupDescription(description);
      setGroupIsPrivate(allowJoin);
      setUpdatedGroupName(nickName);
      setUpdatedGroupDescription(description);
      setUpdatedGroupIcon(icon);
      setUpdatedGroupIsPrivate(allowJoin);
    }
  });

  // モバイル表示用の設定内容 - ポップアップの代わりにフルスクリーンパネルを使用
  const MobileSettingView = () => (
    <Show when={showGroupPopUp() && isSelectRoom()}>
      <div class="fixed inset-0 z-[99999] bg-[#181818] flex flex-col animate-fadeIn">
        <div class="flex items-center justify-between border-b border-gray-700 px-5 py-3">
          <h2 class="text-xl font-semibold text-white">
            {selectedRoom()!.type === "group" ? "グループ" : "友達"}
          </h2>
          <button
            onClick={() =>
              setShowGroupPopUp(false)}
            aria-label="戻る"
            class="text-gray-400 hover:text-white text-2xl transition-colors"
          >
            ←
          </button>
        </div>
        <div class="overflow-y-auto custom-scrollbar flex-1">
          {selectedRoom()?.type === "group"
            ? <GroupSetting />
            : <FriendSetting />}
        </div>
      </div>
    </Show>
  );

  // デスクトップ表示用の設定サイドバー
  const DesktopSettingPanel = () => (
    <Show when={isSelectRoom()}>
      <div
        class="h-screen border"
        style={{
          "border-left": "1px solid #ededed",
          "border-color": "#2b2b2b",
        }}
      >
        <div class="bg-[#181818] w-[320px] flex-shrink-0 overflow-y-auto">
          <div class="flex items-center justify-between border-b px-5 py-3 sticky top-0 bg-[#181818] z-10">
            <h2 class="text-xl font-semibold text-white">
              {selectedRoom()?.type === "group" ? "グループ" : "友達"}
            </h2>
          </div>
          <div class="overflow-y-auto custom-scrollbar flex-1 h-full">
            {selectedRoom()?.type === "group"
              ? <GroupSetting />
              : <FriendSetting />}
          </div>
        </div>
      </div>
    </Show>
  );

  return (
    <>
      {isMobile() ? <MobileSettingView /> : <DesktopSettingPanel />}
    </>
  );
}
