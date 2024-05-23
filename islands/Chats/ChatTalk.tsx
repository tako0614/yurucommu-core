import IsnotSelectUser from "./isnotSelectUser.jsx"
import Profile from "../Settings/Profile.tsx"
import Friends from "../Settings/Friends.tsx"
export default function ChatTalk(props: any) {
  return (
    <>
      <div class="p-talk-chat">
        <div class="p-talk-chat-container">
          <div class="p-talk-chat-title">
            <button class="p-talk-chat-prev">
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
              >
                <title id="chevronLeftIconTitle">Chevron Left</title>{" "}
                <polyline points="14 18 8 12 14 6 14 6" />
              </svg>
            </button>
            <p>たこ2</p>
          </div>
          <div class="p-talk-chat-main">
            <ul class="p-talk-chat-main__ul">
              {/*メッセージ */}
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
  )
}
