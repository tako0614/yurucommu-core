import { useAtom } from "solid-jotai";
import { selectedAppState } from "../states/app.ts";
import {
  selectedExtensionState,
} from "../states/extensions.ts";
import ChatHeader from "./header/header.tsx"; // @ts-ignore: SolidJS component props typing issue
import { Dashboard } from "./DashBoard.tsx";
import ExtensionFrame from "./ExtensionFrame.tsx";


export function Aplication() {
  return (
    <>
      <ChatHeader />
      <main class="wrapper">
        <MainContent />
      </main>
    </>
  );
}

function MainContent() {
  const [selectedApp] = useAtom(selectedAppState);
  const [selectedExtension] = useAtom(selectedExtensionState);
  return (
    <>
      {selectedExtension()
        ? <ExtensionFrame />
        : selectedApp() === "jp.takos.app" && <Dashboard />}
    </>
  );
}
