import Footer from "../Footer.tsx";
import ChatMain from "../../islands/Chats/ChatMain.jsx";
import ChatHeader from "./ChatHeader.jsx";
export default function Talks() {
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
