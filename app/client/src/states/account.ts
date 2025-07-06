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

const STORAGE_KEY = "takos-active-account-id";

export const accounts = atom<Account[]>([]);

// Create an atom for the active account ID with localStorage persistence.
const initialAccountId = localStorage.getItem(STORAGE_KEY);
export const activeAccountId = atom<string | null>(initialAccountId);

activeAccountId.onMount = (set) => {
  const storedId = localStorage.getItem(STORAGE_KEY);
  if (storedId) {
    set(storedId);
  }
};

// A derived atom to write to localStorage whenever the activeAccountId changes.
atom((get) => {
  const id = get(activeAccountId);
  if (id) {
    localStorage.setItem(STORAGE_KEY, id);
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
});

export const activeAccount = atom((get) => {
  const accs = get(accounts);
  const id = get(activeAccountId);
  if (!id) return null;
  return accs.find((a) => a.id === id) ?? null;
});
