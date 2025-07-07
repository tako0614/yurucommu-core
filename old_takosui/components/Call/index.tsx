import { Show } from "solid-js";
import AudiCallFriend from "./friend/audio";
import VideoCallFriend from "./friend/video";
import { atom, useAtom } from "solid-jotai";

export const callState = atom<
  {
    type: "friend" | "group";
    mode: "audio" | "video" | "text";
    friendId?: string;
    roomId?: string;
    roomKeyHash?: string;
    isEncrypted: boolean;
    status: "outgoing" | "incoming" | "connected" | "none";
    //着信側か、発信側か
    isCaller: boolean;
    token?: string; // 通話トークン（サーバーからのIDを格納）
    _audioRef?: HTMLAudioElement; // 内部使用：着信音のリファレンス
  } | null
>(null);

export default function Call() {
  const [call] = useAtom(callState);
  return (
    <>
      <Show
        when={call() && call()!.type === "friend" && call()!.mode === "audio"}
      >
        <AudiCallFriend />
      </Show>
      <Show
        when={call() && call()!.type === "friend" && call()!.mode === "video"}
      >
        <VideoCallFriend />
      </Show>
    </>
  );
}
