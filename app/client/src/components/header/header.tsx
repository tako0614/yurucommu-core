import { useAtom, useSetAtom } from "solid-jotai";
import { selectedAppState } from "../../states/app.ts";
import {
  extensionListState,
  selectedExtensionState,
} from "../../states/extensions.ts";
import { For, onMount } from "solid-js";

export default function ChatHeader() {
  const setSelectedApp = useSetAtom(selectedAppState);
  const [extensions, setExtensions] = useAtom(extensionListState);
  const setSelectedExt = useSetAtom(selectedExtensionState);

  onMount(async () => {
    try {
      const body = {
        events: [{
          identifier: "takos",
          eventId: "extensions:list",
          payload: null,
        }],
      };
      const res = await fetch("/api/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        setExtensions(data[0]?.result ?? []);
      }
    } catch (_e) {
      /* ignore */
    }
  });

  return (
    <>
      <header class="l-header " id="header">
        <ul class="l-header__ul">
          <div
            onClick={() => {
              setSelectedExt(null);
              setSelectedApp("jp.takos.app");
            }}
            class="l-header__ul-item"
          >
            <img
              src={`https://pbs.twimg.com/profile_images/1708867532067893248/1MRc43B5_400x400.jpg`} // ロゴ画像データは現状維持
              alt="takos"
              class="rounded-full h-9 w-9 m-auto"
            />
          </div>
          <For each={extensions()}>
            {(ext) => (
              <li
                class="l-header__ul-item flex"
                onClick={() => {
                  setSelectedExt(ext.identifier);
                }}
              >
                {ext.icon
                  ? (
                    <img
                      src={ext.icon}
                      class="rounded-full m-auto h-[40px]"
                      alt={ext.name}
                    />
                  )
                  : <span class="h-6 w-6 bg-gray-500 inline-block" />}
              </li>
            )}
          </For>
        </ul>
      </header>
    </>
  );
}
