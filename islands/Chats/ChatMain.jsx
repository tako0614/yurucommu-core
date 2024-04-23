import { useState } from "preact/hooks"
import ChatList from "./ChatList.jsx"
import ChatTalk from "./ChatTalk.jsx"
export default function ChatMain(props) {
  if (props.isAddFriendForm) {
    return (
      <>
        <ChatList
          isAddFriendForm={props.isAddFriendForm}
          addFriendKey={props.addFriendKey}
          isChoiceUser={false}
        >
        </ChatList>
        <ChatTalk
          isAddFriendForm={props.isAddFriendForm}
        >
        </ChatTalk>
      </>
    )
  }
  if (props.isSetting) {
    return (
      <>
        <ChatList
          isSetting={props.isSetting}
          isChoiceUser={false}
        >
        </ChatList>
        <ChatTalk
          isSetting={props.isSetting}
        >
        </ChatTalk>
      </>
    )
  }
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
  )
}
