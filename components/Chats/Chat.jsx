import Footer from "../Footer.tsx";
import ChatMain from "../../islands/Chats/ChatMain.jsx";
import ChatHeader from "./ChatHeader.jsx";
export default function Talks(props) {
  return (
    <>
      <ChatHeader></ChatHeader>
      <div class="wrapper">
        <main class="p-talk">
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
  );
}
