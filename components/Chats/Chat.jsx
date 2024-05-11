import Footer from "../Footer.tsx"
import ChatMain from "../../islands/Chats/ChatMain.jsx"
import ChatHeader from "../../islands/Chats/ChatHeader.jsx"
export default function Talks(props) {
  if (props.isAddFriendForm) {
    return (
      <>
        <ChatHeader isChoiceUser={props.isChoiceUser} />
        <div class="wrapper">
          <main class={props.isChoiceUser ? "p-talk is-inview" : "p-talk"} id="chatmain">
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
          <main class={props.isChoiceUser ? "p-talk is-inview" : "p-talk"} id="chatmain">
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
        <main class={props.isChoiceUser ? "p-talk is-inview" : "p-talk"}>
          {props.isChoiceUser
            ? (
              <ChatMain isChoiceUser={props.isChoiceUser} roomid={props.roomid} id="chatmain">
              </ChatMain>
            )
            : <ChatMain isChoiceUser={props.isChoiceUser} id="chatmain"></ChatMain>}
        </main>
      </div>
      <Footer></Footer>
    </>
  )
}
