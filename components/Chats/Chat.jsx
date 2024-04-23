import Footer from "../Footer.tsx"
import ChatMain from "../../islands/Chats/ChatMain.jsx"
import ChatHeader from "../../islands/Chats/ChatHeader.jsx"
export default function Talks(props) {
  if (props.isAddFriendForm) {
    return (
      <>
        <ChatHeader isChoiceUser={props.isChoiceUser} />
        <div class="wrapper">
          <main class={props.isChoiceUser ? "p-talk is-inview" : "p-talk"}>
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
          <main class={props.isChoiceUser ? "p-talk is-inview" : "p-talk"}>
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
              <ChatMain isChoiceUser={props.isChoiceUser} roomid={props.roomid}>
              </ChatMain>
            )
            : <ChatMain isChoiceUser={props.isChoiceUser}></ChatMain>}
        </main>
      </div>
      <Footer></Footer>
    </>
  )
}
