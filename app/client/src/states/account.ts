import { atom } from "solid-jotai";
import { apiFetch } from "../utils/config.ts";

export interface Account {
  id: string;
  userName: string;
  displayName: string;
  avatarInitial: string;
  publicKey: string;
  followers: string[];
  following: string[];
  dms: string[];
}

const STORAGE_KEY = "takos-active-account-id";

export const accounts = atom<Account[]>(
  [],
);

export const setAccounts = atom(
  (get) => get(accounts),
  (_get, set, newAccounts: Account[]) => {
    set(accounts, newAccounts);
  },
);

// 選択中アカウントIDの初期値を localStorage から取得
const initialAccountId = localStorage.getItem(STORAGE_KEY);

// 内部用のAtom
const baseActiveAccountId = atom<string | null>(initialAccountId);

// 書き込み時にlocalStorageへ保存するAtom
export const activeAccountId = atom(
  (get) => get(baseActiveAccountId),
  (_get, set, newId: string | null) => {
    set(baseActiveAccountId, newId);
    if (newId) {
      localStorage.setItem(STORAGE_KEY, newId);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  },
);

export const activeAccount = atom((get) => {
  const accs = get(accounts);
  const id = get(activeAccountId);
  if (!id) return null;
  return accs.find((a) => a.id === id) ?? null;
});

export async function fetchAccounts(): Promise<Account[]> {
  try {
    const res = await apiFetch("/api/accounts");
    return await res.json();
  } catch (_err) {
    return [];
  }
}
