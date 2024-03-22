import Footer from "../Footer.tsx";
import User from "./ChatUserList.jsx";
import ChatHeader from "./ChatHeader.jsx";
import ChatMain from "./ChatTalk.jsx";
export default function Talks() {
  return (
    <>
      <ChatHeader></ChatHeader>
      <div class="wrapper">
        <main class="p-talk">
          <div class="p-talk-list">
            <h1 class="p-talk-list-title">トーク</h1>
            <div class="p-talk-list-search">
              <form name="talk-search">
                <label>
                  <input
                    type="text"
                    placeholder="トークルーム・メッセージを検索"
                  />
                </label>
              </form>
            </div>
            <div class="p-talk-list-rooms">
              <ul class="p-talk-list-rooms__ul">
                <User userName="たこ" latestMessage="にゃーーー"></User>
                <User userName="たこ2" latestMessage="たこたこ"></User>
                <User userName="たこ3" latestMessage="love"></User>
                <User userName="たこ" latestMessage="にゃーーー"></User>
                <User userName="たこ2" latestMessage="たこたこ"></User>
                <User userName="たこ3" latestMessage="love"></User>
                <User userName="たこ" latestMessage="にゃーーー"></User>
                <User userName="たこ" latestMessage="にゃーーー"></User>
                <User userName="たこ2" latestMessage="たこたこ"></User>
              </ul>
            </div>
          </div>
          <ChatMain></ChatMain>
        </main>
      </div>
      <Footer></Footer>
    </>
  );
}
