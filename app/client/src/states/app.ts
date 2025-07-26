import { atom } from "solid-jotai";

// アプリケーションページの型定義
export type AppPage =
  | "home"
  | "profile"
  | "microblog"
  | "chat"
  | "tools"
  | "videos";

// 選択中のアプリケーションページを管理する状態
// 初期値を"home"にしてホーム画面を表示
export const selectedAppState = atom<AppPage>("chat");
