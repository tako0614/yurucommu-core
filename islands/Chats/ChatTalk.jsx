import ChatDate from "../../components/Chats/ChatDate.jsx";
import ChatTitle from "../../components/Chats/ChatTitle.jsx";
import ChatOtherMessages from "../../components/Chats/ChatOtherMessage.jsx";
import ChatSendMessages from "../../components/Chats/ChatSendMessage.jsx";
import WebSocket from "ws";
import { useEffect, useState } from "preact/hooks";
export default function ChatTalk({isChoiceUser,setIsChoiceUser,a}) {
  return (
    <>
      <div class="p-talk-chat">
        <div class="p-talk-chat-container">
          <ChatTitle title="たこ" />
          <div class="p-talk-chat-main">
            <ul class="p-talk-chat-main__ul">
              <ChatDate date={new Date()} />
              <ChatOtherMessages
                sender="たこ"
                message="愛してるよ♡
              結婚しようね"
                time={new Date()}
              />
              <ChatOtherMessages
                sender="たこ"
                message="オブジェクトだぁ！"
                time={new Date()}
              />
              <ChatSendMessages
                message="わたしも♡"
                time={new Date()}
                isRead={true}
              />
              <ChatSendMessages
                message="結婚しよう！"
                time={new Date()}
                isRead={true}
              />
              <ChatOtherMessages
                sender="たこ"
                message="♡♡♡"
                time={new Date()}
              />
              <p>{a}</p>
              <button
                onClick={() => {
                  setIsChoiceUser(!isChoiceUser);
                }}
              >
                たこたこボタン
              </button>
            </ul>
          </div>
          <div class="p-talk-chat-send">
            <form class="p-talk-chat-send__form">
              <div class="p-talk-chat-send__msg">
                <div class="p-talk-chat-send__dummy" aria-hidden="true">
                </div>
                <label>
                  <textarea
                    class="p-talk-chat-send__textarea"
                    placeholder="メッセージを入力"
                  >
                  </textarea>
                </label>
              </div>
              <div class="p-talk-chat-send__file">
                <img src="static/clip.svg" alt="file" />
              </div>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}
