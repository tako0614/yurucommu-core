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

// アカウントの基本統計情報（投稿数・フォロー/フォロワー数）を格納
export type AccountStats = {
  postCount: number;
  followersCount: number;
  followingCount: number;
};

// key は account.id
export const accountStatsMap = atom<Record<string, AccountStats>>({});

export const setAccountStatsMap = atom(
  (get) => get(accountStatsMap),
  (_get, set, payload: { accountId: string; stats: AccountStats }) => {
    set(
      accountStatsMap,
      (prev) => ({ ...prev, [payload.accountId]: payload.stats }),
    );
  },
);

// フォロー/フォロワー一覧のキャッシュ（key は account.id）
export const followingListMap = atom<Record<string, unknown[]>>({});
export const followersListMap = atom<Record<string, unknown[]>>({});

export const setFollowingList = atom(
  (get) => get(followingListMap),
  (_get, set, payload: { accountId: string; list: unknown[] }) => {
    set(
      followingListMap,
      (prev) => ({ ...prev, [payload.accountId]: payload.list }),
    );
  },
);

export const setFollowersList = atom(
  (get) => get(followersListMap),
  (_get, set, payload: { accountId: string; list: unknown[] }) => {
    set(
      followersListMap,
      (prev) => ({ ...prev, [payload.accountId]: payload.list }),
    );
  },
);
