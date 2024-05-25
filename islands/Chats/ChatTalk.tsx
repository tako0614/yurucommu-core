import ChatDate from "../../components/Chats/ChatDate.tsx"
import ChatSendMessage from "../../components/Chats/ChatSendMessage.jsx"
import ChatOtherMessage from "../../components/Chats/ChatOtherMessage.jsx"
import { useEffect, useState } from "preact/hooks"
export default function ChatTalk(props: any) {
  const [roomName, setRoomName] = useState("")
  const [talkData, setTalkData] = useState("")
  const [ws, setWs] = useState<WebSocket | null>(null)
  useEffect(() => {
    async function getRoom() {
      console.log("aaaa")
      const roomid = props.roomid
      const talkdata = await fetch(
        `/api/v1/chats/talkdata?roomid=${roomid}&startChat=true`,
      )
      const talkdatajson = await talkdata.json()
      console.log(talkdatajson.messages)
      setRoomName(talkdatajson.roomname)
      //setWs(new WebSocket("/api/v1/chats/talk"))
    }
    if (props.roomid) {
      getRoom()
    }
  }, [props.isSelectUser])
  if (props.roomid) {
    return (
      <>
        <div class="p-talk-chat">
          <div class="p-talk-chat-container">
            <div class="p-talk-chat-title">
              <button
                class="p-talk-chat-prev"
                onClick={() => {
                  props.setIsChoiceUser(false)
                  props.setRoomid("")
                  //urlを変更
                  history.pushState("", "", "/talk")
                }}
              >
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
              <p>{roomName}</p>
            </div>
            <div class="p-talk-chat-main">
              <ul class="p-talk-chat-main__ul">
                {
                }
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
                  <img src="./ei-send.svg" alt="file" />
                </div>
              </form>
            </div>
          </div>
        </div>
      </>
    )
  }
  return (
    <>
      <div class="p-talk-chat">
        <div class="p-talk-chat-container">
          <div class="text-center">
            トークを始めましょう！！
          </div>
        </div>
      </div>
    </>
  )
}
