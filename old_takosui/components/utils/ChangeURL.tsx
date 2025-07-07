import { createEffect } from "solid-js";
import { loadState, loginState, pageState } from "../../utils/state";
import { useAtom } from "solid-jotai";

function getExpectedUrl(page: string): string {
  const mapping: Record<string, string> = {
    home: "/home",
    talk: "/talk",
    friend: "/friend",
    setting: "/setting",
    notification: "/notification",
  };

  // 現在のURLからページタイプとパスパラメータを抽出
  const currentUrl = window.location.pathname;
  const baseUrl = mapping[page] || "/";

  // 現在のURLが同じページタイプで始まっている場合、そのURLを優先する
  if (currentUrl.startsWith(`/${page}/`)) {
    return currentUrl;
  }

  return baseUrl;
}

export function ChangeURL() {
  const [login] = useAtom(loginState);
  const [page] = useAtom(pageState);
  const [load] = useAtom(loadState);

  createEffect(() => {
    if (!load()) return;
    const url = window.location.pathname;
    if (!login()) {
      if (url !== "/") {
        window.history.pushState(null, "", "/");
      }
      return;
    }
    const expectedUrl = getExpectedUrl(page()!);
    if (url !== expectedUrl) {
      window.history.pushState(null, "", expectedUrl);
    }
  });

  return <></>;
}
