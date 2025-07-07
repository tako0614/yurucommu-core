import { useAtom, useAtomValue } from "solid-jotai";
import { nickNameState } from "../../../utils/room/roomState";
export default function ChatTalkTitleContent() {
  const nickName = useAtomValue(nickNameState);
  return <h2>{nickName()}</h2>;
}
