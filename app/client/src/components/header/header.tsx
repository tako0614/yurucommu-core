import { useSetAtom } from "solid-jotai";
import { selectedAppState } from "../../states/app.ts";

export default function ChatHeader() {
  const setSelectedApp = useSetAtom(selectedAppState);

  return (
    <>
      <header class="l-header " id="header">
        <ul class="l-header__ul">
          <div
            onClick={() => {
              setSelectedApp("dashboard");
            }}
            class="l-header__ul-item"
          >
            <span class="m-auto">ダッシュボード</span>
          </div>
          <div
            onClick={() => {
              setSelectedApp("settings");
            }}
            class="l-header__ul-item"
          >
            <span class="m-auto">設定</span>
          </div>
        </ul>
      </header>
    </>
  );
}
