import { atom } from "solid-jotai";

export interface Account {
  id: string;
  userName: string;
  displayName: string;
  avatarInitial: string;
  publicKey: string;
  followers: string[];
  following: string[];
}

export const accounts = atom<Account[]>([]);
export const activeAccountId = atom<string | null>(null);

export const activeAccount = atom((get) => {
  const accs = get(accounts);
  const id = get(activeAccountId);
  if (!id) return null;
  return accs.find((a) => a.id === id) ?? null;
});
