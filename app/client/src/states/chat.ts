import { atom } from "solid-jotai";

// 選択中のチャットルームを管理する状態
export const selectedRoomState = atom<string | null>(null);
