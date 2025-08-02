import { atom } from "solid-jotai";

export const darkModeState = atom(true);
export const languageState = atom("ja");
// マイクロブログの表示件数
export const microblogPostLimitState = atom(20);
