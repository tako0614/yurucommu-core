import { createEffect } from "solid-js";
import { useAtom } from "solid-jotai";
import { selectedFriendTabState } from "../../../utils/room/settingRoomState.ts";
import { GroupSettingMenu } from "./Menu.tsx";
import { GroupSettingDetail } from "./Detail.tsx";
import { GroupSettingInvite } from "./Invite.tsx";
import { GroupSettingLeave } from "./Leave.tsx";
import { GroupSettingRole } from "./Role.tsx";
import { GroupSettingMember } from "./Member.tsx";
import { GroupSettingBan } from "./Ban.tsx";
import { GroupSettingRequest } from "./Request.tsx";
import { SettingEncryption } from "../SettingEncryption.tsx";

export const availablePermissions = [
  `ADMIN`,
  "MANAGE_CHANNEL",
  `MANAGE_USER`,
  `INVITE_USER`,
  `MANAGE_SERVER`,
  `VIEW_LOG`,
];

export function GroupSetting() {
  const [_, setSelectedFriendTab] = useAtom(selectedFriendTabState);

  // コンポーネントのマウント時に、フレンドの選択状態をリセット
  createEffect(() => {
    setSelectedFriendTab(false);
  });

  return (
    <>
      <GroupSettingMenu />
      <GroupSettingDetail />
      <GroupSettingInvite />
      <GroupSettingLeave />
      <GroupSettingRole />
      <GroupSettingMember />
      <GroupSettingRequest />
      <GroupSettingBan />
      <SettingEncryption type="group" />
    </>
  );
}
