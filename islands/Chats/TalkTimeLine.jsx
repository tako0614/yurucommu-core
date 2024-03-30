import ChatTitle from "../../components/Chats/ChatTitle.jsx";
import ChatDate from "../../components/Chats/ChatDate.jsx";
import ChatOtherMessages from "../../components/Chats/ChatOtherMessage.jsx";
import ChatSendMessages from "../../components/Chats/ChatSendMessage.jsx";
export default function TalkTimeLine(props) {
  const { userName, friendName } = props;

  return (
    <>
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
          <button
            onClick={() => {
              setIsChoiceUser(!isChoiceUser);
            }}
          >
            たこたこボタン
          </button>
        </ul>
      </div>
    </>
  );
}
