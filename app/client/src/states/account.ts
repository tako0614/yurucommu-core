import { atom } from "solid-jotai";

// 現在選択中のアカウントIDを管理する状態
export const selectedAccountState = atom<string>("");
