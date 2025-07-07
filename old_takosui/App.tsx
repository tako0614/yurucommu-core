import { loadState, loginState, pageState } from "./utils/state.ts";
import { useAtom } from "solid-jotai";
import { Load, Loading } from "./components/load.tsx";
import { Css } from "./components/utils/Css.tsx";
import "./App.css";
import { ChangeURL } from "./components/utils/ChangeURL.tsx";
import { Register } from "./components/register/index.tsx";
import { Chat } from "./components/Chat.tsx";
import { createEffect, createSignal, Show } from "solid-js";
import {
  CreateIdentityKeyPopUp,
  CreateShareSignKeyPopUp,
} from "./components/encrypted/CreateIdentityKeyPopUp.tsx";
import { CreateGroupPopUp } from "./components/utils/CreateGroup.tsx";
import { MigrateKey } from "./components/encrypted/MigrateKeys.tsx";
import {
  contextMenuPositionState,
  showEditChannelModalState,
} from "./components/talk/Content.tsx";
import { ImageViewer } from "./components/talk/message/ImageViewer.tsx";
import { VideoPlayer } from "./components/talk/message/VideoPlayer.tsx";
import { ChannelEditModal } from "./components/talk/sideBar/ChannelEditModal.tsx";
import { CreateChannelModal } from "./components/talk/sideBar/CreateChannelModal.tsx";
import { MentionListModal } from "./components/talk/message/MentionDisplay.tsx";
import { SelectedServer } from "./components/register/selectServer.tsx";
import Call from "./components/Call/index.tsx";

function App(
  { page }: { page?: "home" | "talk" | "friend" | "setting" | "notification" },
) {
  const [load] = useAtom(loadState);
  const [login] = useAtom(loginState);
  const [_page, setPageState] = useAtom(pageState);
  const [contextMenuPosition, setContextMenuPosition] = useAtom(
    contextMenuPositionState,
  );
  const [showEditChannelModal, setShowEditChannelModal] = useAtom(
    showEditChannelModalState,
  );
  const [isMobile] = createSignal(window.innerWidth <= 768);

  setPageState(page || "talk");
  createEffect(() => {
    console.log(load(), login());
  });
  const [isSelectedServer, setIsSelectedServer] = createSignal(
    !!window.serverEndpoint,
  );
  return (
    <>
      <Show when={isSelectedServer()}>
        <CreateChannelModal />
        {!load() && <Loading />}
        <CreateIdentityKeyPopUp />
        <CreateShareSignKeyPopUp />
        <CreateGroupPopUp />
        <Css />
        <ChangeURL />
        <Load />
        <MigrateKey />
        {load() && login() && <Chat />}
        {load() && !login() && <Register />}
        {showEditChannelModal() && (
          <ChannelEditModal
            channel={contextMenuPosition().id}
            type={contextMenuPosition().type!}
            onClose={setShowEditChannelModal}
          />
        )}
        <ImageViewer />
        <VideoPlayer />
        <MentionListModal />
      </Show>
      <Show when={!isSelectedServer()}>
        <SelectedServer
          setIsSelectedServer={setIsSelectedServer}
        />
      </Show>
      <Call />
    </>
  );
}

export default App;
