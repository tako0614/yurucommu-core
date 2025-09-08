import { atom } from "solid-jotai";
import type { MicroblogPost } from "../components/microblog/types.ts";

// マイクロブログの投稿リストを管理する状態
export const microblogPostsState = atom<MicroblogPost[]>([]);

// マイクロブログのページネーションカーソルを管理する状態
export const microblogCursorState = atom<string | null>(null);

// マイクロブログの追加読み込み状態を管理する状態
export const microblogLoadingMoreState = atom<boolean>(false);

// マイクロブログの初期読み込み状態を管理する状態
export const microblogLoadingInitialState = atom<boolean>(true);

// マイクロブログのモバイルタブを管理する状態
export const microblogMobileTabState = atom<"latest" | "following">("following");
