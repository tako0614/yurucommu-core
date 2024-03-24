import { useState } from "preact/hooks";
import User from "../../components/Chats/ChatUserList.jsx";
function  ChatList({ isChoiceUser, setIsChoiceUser, a }) {
  return (
    <div class={isChoiceUser ? "pm-talk-list" : "p-talk-list"}>
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
          <button
          onClick={() => {
            setIsChoiceUser(!isChoiceUser);
          }}
        >
          たこたこボタン
        </button>
        </ul>
      </div>
    </div>
  );
};
export default ChatList;