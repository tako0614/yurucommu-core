import { createEffect, onMount } from "solid-js";
import { useAtom } from "solid-jotai";
import {
  activeAccountId,
  fetchAccounts,
  setAccounts,
} from "../states/account.ts";
import { getDomain } from "./config.ts";
import { fetchFollowers, fetchFollowing, fetchUserProfile } from "../components/microblog/api.ts";
import { setAccountStatsMap, setFollowersList, setFollowingList } from "../states/account.ts";

export function useInitialLoad() {
  const [, setAccs] = useAtom(setAccounts);
  const [actId, setActId] = useAtom(activeAccountId);
  const [statsMap, setStats] = useAtom(setAccountStatsMap);
  const [, setFollowers] = useAtom(setFollowersList);
  const [, setFollowing] = useAtom(setFollowingList);

  onMount(async () => {
    try {
      const results = await fetchAccounts();
      setAccs(results);
      const currentId = actId();
      const exists = results.some((acc) => acc.id === currentId);
      if (!exists && results.length > 0) {
        setActId(results[0].id);
      }
    } catch (err) {
      console.error("アカウント情報の取得に失敗しました", err);
    }
  });

  // アクティブアカウントの基本情報（フォロー/フォロワー・投稿数）を常に取得
  createEffect(async () => {
    const currentId = actId();
    if (!currentId) return;

    // 既に一度取得済みならスキップ（必要に応じて TODO: 有効期限導入）
    if (statsMap()[currentId]) return;

    try {
      const allAccounts = await fetchAccounts();
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
