import { atom } from "solid-jotai";
import type { Room } from "../components/chat/types.ts";

// 選択中のチャットルームを管理する状態
export const selectedRoomState = atom<string | null>(null);

// チャットルームリストを管理する状態
export const chatRoomsState = atom<Room[]>([]);

// ルーム読み込み状態を管理する状態
export const roomsReadyState = atom<boolean>(false);
