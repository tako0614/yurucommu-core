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
              setSelectedApp("home");
            }}
            class="l-header__ul-item"
          >
            <span class="m-auto">Home</span>
          </div>
        </ul>
      </header>
    </>
  );
}
