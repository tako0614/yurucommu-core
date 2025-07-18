import { atom } from "solid-jotai";
import type { Instance } from "./api.ts";

export const loggedInState = atom(false);
export const userNameState = atom("");
export const passwordState = atom("");
export const instancesState = atom<Instance[]>([]);
export const hostState = atom("");
export const rootDomainState = atom("");
export const termsRequiredState = atom(false);
