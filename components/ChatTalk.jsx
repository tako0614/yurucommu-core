export default function ChatTalk() {
  return (
    <>
      <div class="p-talk-chat">
        <div class="p-talk-chat-container">
          <div class="p-talk-chat-title">
            <div class="p-talk-chat-prev">
              <svg
                role="img"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                aria-labelledby="chevronLeftIconTitle"
                stroke="#000000"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                fill="none"
                color="#000000"
              >
                <title id="chevronLeftIconTitle">Chevron Left</title>{" "}
                <polyline points="14 18 8 12 14 6 14 6" />
              </svg>
            </div>
            <p>たこ2</p>
          </div>
          <div class="p-talk-chat-main">
            <ul class="p-talk-chat-main__ul">
              <ChatDate />
              <li class="c-talk-chat other primary">
                <div class="c-talk-chat-box">
                  <div class="c-talk-chat-icon">
                    <img src="static/logo.png" alt="" />
                  </div>
                  <div class="c-talk-chat-right">
                    <div class="c-talk-chat-name">
                      <p>たこ</p>
                    </div>
                    <div class="c-talk-chat-msg">
                      <p>
                        メッセージ<br />改行
                      </p>
                    </div>
                  </div>
                </div>
              </li>
              <li class="c-talk-chat other subsequent">
                <div class="c-talk-chat-box">
                  <div class="c-talk-chat-right">
                    <div class="c-talk-chat-msg">
                      <p>
                        メッセージあああああああああああああああああああああああああああ
                      </p>
                    </div>
                  </div>
                  <div class="c-talk-chat-date">
                    <p>午後 8:00</p>
                  </div>
                </div>
              </li>
              <li class="c-talk-chat self primary">
                <div class="c-talk-chat-box">
                  <div class="c-talk-chat-right">
                    <div class="c-talk-chat-msg">
                      <p>
                        メッセージ<br />改行<br />改行<br />改行<br />改行<br />改行<br />改行<br />改行<br />改行<br />改行<br />改行
                      </p>
                    </div>
                  </div>
                </div>
              </li>
            </ul>
            <li class="c-talk-chat self subsequent">
              <div class="c-talk-chat-box">
                <div class="c-talk-chat-date">
                  <p>既読</p>
                  <p>午後 8:01</p>
                </div>
                <div class="c-talk-chat-right">
                  <div class="c-talk-chat-msg">
                    <p>
                      メッセージあああああああああああああああああああああああああああ
                    </p>
                  </div>
                </div>
              </div>
            </li>
            <li class="c-talk-chat other primary">
              <div class="c-talk-chat-box">
                <div class="c-talk-chat-icon">
                  <img src="static/logo.png" alt="" />
                </div>
                <div class="c-talk-chat-right">
                  <div class="c-talk-chat-name">
                    <p>たこ</p>
                  </div>
                  <div class="c-talk-chat-msg">
                    <p>オブジェクトだぁ！</p>
                  </div>
                </div>
                <div class="c-talk-chat-date">
                  <p>午後 8:03</p>
                </div>
              </div>
            </li>
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
const ChatDate = () => {
  reutrn(
    <li class="c-talk-date">
      <div class="c-talk-chat-date-box">
        <p>今日</p>
      </div>
    </li>,
  );
};
