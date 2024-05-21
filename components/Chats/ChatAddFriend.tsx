import Footer from "../Footer.tsx"
import ChatList from "../../islands/Chats/FriendAddList.jsx"
import ChatTalk from "../../islands/Chats/ChatTalk.tsx"
import ChatHeader from "../../islands/Chats/ChatHeader.tsx"
export default function Talks(props: { origin: any }) {
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
