import { onMount } from "solid-js";
import { useAtom } from "solid-jotai";
import {
  activeAccountId,
  fetchAccounts,
  setAccounts,
} from "../states/account.ts";

export function useInitialLoad() {
  const [, setAccs] = useAtom(setAccounts);
  const [actId, setActId] = useAtom(activeAccountId);

  onMount(async () => {
    try {
      const results = await fetchAccounts();
      setAccs(results);
      if (!actId() && results.length > 0) {
        setActId(results[0].id);
      }
    } catch (err) {
      console.error("アカウント情報の取得に失敗しました", err);
    }
  });
}
