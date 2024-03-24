import { useState } from "preact/hooks"
import ChatList from "./ChatList.jsx"
import ChatTalk from "./ChatTalk.jsx"
export default function ChatMain() {
    const [isChoiceUser, setIsChoiceUser] = useState(false);
  return (
    <>
    <ChatList
    isChoiceUser={isChoiceUser}
    setIsChoiceUser={setIsChoiceUser}
    ></ChatList>
    <ChatTalk
    isChoiceUser={isChoiceUser}
    setIsChoiceUser={setIsChoiceUser}
    ></ChatTalk>
    </>
  )
}
