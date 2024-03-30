import Footer from "../Footer.tsx";
import ChatMain from "../../islands/Chats/ChatMain.jsx";
import ChatList from "../../islands/Chats/FriendAddList.jsx";
import ChatTalk from "../../islands/Chats/ChatTalk.jsx";
import ChatHeader from "./ChatHeader.jsx";
export default function Talks() {
  return (
    <>
      <ChatHeader></ChatHeader>
      <div class="wrapper">
        <main class="p-talk">
          <ChatList>
          </ChatList>
          <ChatTalk>
          </ChatTalk>
        </main>
      </div>
      <Footer></Footer>
    </>
  );
}
