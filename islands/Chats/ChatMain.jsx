import { useState } from "preact/hooks";
import ChatList from "./ChatList.jsx";
import ChatTalk from "./ChatTalk.jsx";
export default function ChatMain(props) {
  return (
    <>
      <ChatList
        isChoiceUser={props.isChoiceUser}
      >
      </ChatList>
      <ChatTalk
        isChoiceUser={props.isChoiceUser}
        roomid={props.roomid}
      >
      </ChatTalk>
    </>
  );
}
