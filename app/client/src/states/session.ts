import { atom } from "solid-jotai";

export const loginState = atom<boolean | null>(null);
export const sessionPasswordState = atom<string | null>(null);
