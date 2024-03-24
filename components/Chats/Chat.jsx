import Footer from "../Footer.tsx";
import UserList from "../../islands/Chats/ChatList.jsx";
import ChatHeader from "./ChatHeader.jsx";
import ChatMain from "../../islands/Chats/ChatTalk.jsx";
export default function Talks() {
  return (
    <>
      <ChatHeader></ChatHeader>
      <div class="wrapper">
        <main class="p-talk">
          <UserList></UserList>
          <ChatMain></ChatMain>
        </main>
      </div>
      <Footer></Footer>
    </>
  );
}
