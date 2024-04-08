import Footer from "../Footer.tsx"
import ChatList from "../../islands/Chats/FriendAddList.jsx"
import ChatTalk from "../../islands/Chats/ChatTalk.jsx"
import ChatHeader from "../../islands/Chats/ChatHeader.jsx"
export default function Talks(props) {
  return (
    <>
      <ChatHeader></ChatHeader>
      <div class="wrapper">
        <main class="p-talk">
          <ChatList origin={props.origin}>
          </ChatList>
          <ChatTalk>
          </ChatTalk>
        </main>
      </div>
      <Footer></Footer>
    </>
  )
}
