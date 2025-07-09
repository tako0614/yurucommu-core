import { atom } from "solid-jotai";

export const loginState = atom<boolean | null>(null);
export const encryptionKeyState = atom<string | null>(null);
