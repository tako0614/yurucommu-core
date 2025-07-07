import { atom } from "solid-jotai";

export const selectedRoomState = atom<
  {
    roomName: string;
    roomid: string;
    type: "group" | "friend";
  } | null
>();

export const isSelectRoomState = atom<boolean>(false);
export const roomKeyState = atom<{
  userId: string;
  key: string;
  metaData: string;
  id: string;
}[]>([]);
export const selectedChannelState = atom<string | null>(null);
export const nickNameState = atom<string | null>("選択してください");

// メンションリスト用の状態
export const mentionListState = atom<string[]>([]);

// リプライターゲット用の状態
export const replyTargetState = atom<{ id: string; content: string } | null>(
  null,
);
