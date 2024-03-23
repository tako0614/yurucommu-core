import Footer from "../Footer.tsx";
import User from "./ChatUserList.jsx";
import ChatHeader from "./ChatHeader.jsx";
import ChatMain from "../../islands/Chats/ChatTalk.jsx";
import { useEffect, useState } from "preact/hooks";
export default function Talks() {
  const [isChoiceUser, setIsChoiceUser] = useState(false);
  return (
    <>
      <ChatHeader></ChatHeader>
      <div class="wrapper">
        <main class="p-talk">
          <ChatMain></ChatMain>
        </main>
      </div>
      <Footer></Footer>
    </>
  );
}
