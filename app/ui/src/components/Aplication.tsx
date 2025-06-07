import { useAtom } from "solid-jotai";
import { selectedAppState } from "../states/app.ts";
import ChatHeader from "./header/header.tsx"; // @ts-ignore: SolidJS component props typing issue
import { Dashboard } from "./DashBoard.tsx";


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
  return (
    <>
      {selectedApp() === "jp.takos.app" && (
        <Dashboard />
      )}
    </>
  );
}
