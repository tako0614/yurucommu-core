import TalkTimeLine from "./TalkTimeLine.jsx";
export default function ChatTalk({ isChoiceUser, setIsChoiceUser, a }) {
  return (
    <>
      <div class="p-talk-chat">
        <div class="p-talk-chat-container">
          <TalkTimeLine />
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
