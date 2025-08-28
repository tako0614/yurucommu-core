import { createEffect, onMount } from "solid-js";
import { useAtom } from "solid-jotai";
import {
  type Account,
  activeAccountId,
  fetchAccounts,
  setAccounts,
} from "../states/account.ts";
import { getDomain } from "./config.ts";
import {
  fetchFollowers,
  fetchFollowing,
  fetchUserProfile,
} from "../components/microblog/api.ts";
import {
  setAccountStatsMap,
  setFollowersList,
  setFollowingList,
} from "../states/account.ts";

// キャッシュの有効期限（5分）
const CACHE_TTL_MS = 5 * 60 * 1000;

// アカウント一覧のキャッシュ
let accountsCache: Account[] | null = null;
let accountsFetchedAt = 0;

// 各アカウント統計情報の取得時刻
const statsFetchedAtMap: Record<string, number> = {};

export function useInitialLoad() {
  const [, setAccs] = useAtom(setAccounts);
  const [actId, setActId] = useAtom(activeAccountId);
  const [statsMap, setStats] = useAtom(setAccountStatsMap);
  const [, setFollowers] = useAtom(setFollowersList);
  const [, setFollowing] = useAtom(setFollowingList);

  onMount(async () => {
    try {
      const now = Date.now();
      if (!accountsCache || now - accountsFetchedAt > CACHE_TTL_MS) {
        accountsCache = await fetchAccounts();
        accountsFetchedAt = now;
      }
      setAccs(accountsCache || []);
      const currentId = actId();
      const exists = accountsCache?.some((acc) => acc.id === currentId);
      if (!exists && (accountsCache?.length ?? 0) > 0) {
        setActId(accountsCache![0].id);
      }
    } catch (err) {
      console.error("アカウント情報の取得に失敗しました", err);
    }
  });

  // アクティブアカウントの基本情報（フォロー/フォロワー・投稿数）を常に取得
  createEffect(async () => {
    const currentId = actId();
    if (!currentId) return;

    const now = Date.now();

    // キャッシュが有効なら再取得しない
    if (
      statsMap()[currentId] &&
      now - (statsFetchedAtMap[currentId] ?? 0) < CACHE_TTL_MS
    ) {
      return;
    }

    try {
      let allAccounts = accountsCache;
      if (!allAccounts || now - accountsFetchedAt > CACHE_TTL_MS) {
        allAccounts = await fetchAccounts();
        accountsCache = allAccounts;
        accountsFetchedAt = now;
        setAccs(allAccounts);
      }

      const acc = allAccounts.find((a) => a.id === currentId);
      if (!acc) return;
      const username = acc.userName;

      const domain = getDomain();
      const profile = await fetchUserProfile(`${username}@${domain}`);
      if (profile) {
        setStats({
          accountId: currentId,
          stats: {
            postCount: profile.postCount ?? 0,
            followersCount: profile.followersCount ?? 0,
            followingCount: profile.followingCount ?? 0,
          },
        });
        statsFetchedAtMap[currentId] = now;
      }

      // フォロー/フォロワー一覧（軽量でない可能性があるため必要最低限のみ）
      const [followers, following] = await Promise.all([
        fetchFollowers(username),
        fetchFollowing(username),
      ]);
      setFollowers({ accountId: currentId, list: followers || [] });
      setFollowing({ accountId: currentId, list: following || [] });
    } catch (err) {
      console.error("基本情報の取得に失敗しました", err);
    }
  });
}
