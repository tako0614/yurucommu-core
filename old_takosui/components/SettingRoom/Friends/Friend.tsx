import { createEffect } from "solid-js";
import { useAtom } from "solid-jotai";
import {
  selectedFriendTabState,
  selectedTabState,
} from "../../../utils/room/settingRoomState";
import { FriendSettingMenu } from "./Menu";
import { FriendSettingChat } from "./Chat";
import SettingEncryption from "../SettingEncryption";

export function FriendSetting() {
  const [_, setSelectedTab] = useAtom(selectedTabState);

  // コンポーネントのマウント時に、グループの選択状態をリセット
  createEffect(() => {
    setSelectedTab(false);
  });

  return (
    <>
      <FriendSettingMenu />
      <FriendSettingChat />
      <SettingEncryption type="friend" />
    </>
  );
}
