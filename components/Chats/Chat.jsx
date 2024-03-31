import Footer from "../Footer.tsx";
import ChatMain from "../../islands/Chats/ChatMain.jsx";
import ChatHeader from "../../islands/Chats/ChatHeader.jsx";
export default function Talks(props) {
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
  );
}
const AddFriendForm = () => {
  reutn(
    <>
      <div class="fixed z-50 w-full h-full overflow-hidden bg-[rgba(91,112,131,0.4)] left-0 top-0">
        <div class="bg-[#010005] lg:w-1/3 w-full h-full lg:h-2/3 mx-auto lg:my-[7%] p-5 lg:rounded-xl">
          <div class="flex justify-end bg-blue-500">
            <span
              class="ml-0 text-3xl text-gray-400 font-[bold] no-underline cursor-pointer"
              onClick={handleButtonClick}
            >
              ×
            </span>
          </div>
          <div class="w-4/5 mx-auto my-0">
            テストメッセージ
          </div>
        </div>
      </div>
    </>,
  );
};
