import { atom } from "solid-jotai";

// 選択中のアプリケーションページを管理する状態
// 初期値を"home"にしてホーム画面を表示
export const selectedAppState = atom("home");
