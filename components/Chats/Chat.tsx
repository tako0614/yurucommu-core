import Footer from "../Footer.tsx"
import ChatMain from "../../islands/Chats/ChatMain.tsx"
import ChatHeader from "../../islands/Chats/ChatHeader.tsx"
export default function Talks(
  props: {
    isAddFriendForm?: any
    isChoiceUser?: any
    addFriendKey?: any
    roomid?: any
    isSetting?: any
  },
) {
  if (props.isAddFriendForm) {
    return (
      <>
        <ChatHeader isChoiceUser={props.isChoiceUser} />
        <div class="wrapper">
          <main
            class={props.isChoiceUser ? "p-talk is-inview" : "p-talk"}
            id="chatmain"
          >
            <ChatMain
              isAddFriendForm={props}
              addFriendKey={props.addFriendKey}
              roomid={props.roomid}
            />
          </main>
        </div>
        <Footer></Footer>
      </>
    )
  }
  if (props.isSetting) {
    return (
      <>
        <ChatHeader isChoiceUser={props.isChoiceUser} />
        <div class="wrapper">
          <main
            class={props.isChoiceUser ? "p-talk is-inview" : "p-talk"}
            id="chatmain"
          >
            <ChatMain
              isSetting={props.isSetting}
              roomid={props.roomid}
            />
          </main>
        </div>
        <Footer></Footer>
      </>
    )
  }
  return (
    <>
      <ChatHeader isChoiceUser={props.isChoiceUser} />
      <div class="wrapper">
        <main
          class={props.isChoiceUser ? "p-talk is-inview" : "p-talk"}
        >
          {props.isChoiceUser
            ? (
              <ChatMain
                isChoiceUser={props.isChoiceUser}
                roomid={props.roomid}
              >
              </ChatMain>
            )
            : (
              <ChatMain
                isChoiceUser={props.isChoiceUser}
              >
              </ChatMain>
            )}
        </main>
      </div>
      <Footer></Footer>
    </>
  )
}
