import { useAtom } from "solid-jotai";
import { selectedAppState } from "../states/app.ts";
import ChatHeader from "./header/header.tsx"; // @ts-ignore: SolidJS component props typing issue
import { Dashboard } from "./DashBoard.tsx";
import ExtensionManagerComponent from "./ExtensionManager.tsx";
import { createSignal, Show } from "solid-js";

export function Aplication() {
  const [showExtensionManager, setShowExtensionManager] = createSignal(false);

  return (
    <>
      <ChatHeader />
      <main class="wrapper">
        <Show when={showExtensionManager()}>
          <ExtensionManagerComponent
            onBack={() => setShowExtensionManager(false)}
          />
        </Show>
        <Show when={!showExtensionManager()}>
          <MainContent onShowExtensions={() => setShowExtensionManager(true)} />
        </Show>
      </main>
    </>
  );
}

function MainContent(props: { onShowExtensions: () => void }) {
  const [selectedApp] = useAtom(selectedAppState);
  return (
    <>
      {selectedApp() === "jp.takos.app" && (
        <Dashboard onShowExtensions={props.onShowExtensions} />
      )}
    </>
  );
}
