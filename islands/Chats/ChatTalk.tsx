type TalkDataItem = {
  type: string
  message: string
  id?: string // idが文字列であると仮定します。必要に応じて適切な型に変更してください。
  time: string
  isRead: boolean
  sender?: string
}
import ChatDate from "../../components/Chats/ChatDate.tsx"
import ChatSendMessage from "../../components/Chats/ChatSendMessage.jsx"
import ChatOtherMessage from "../../components/Chats/ChatOtherMessage.jsx"
import { useEffect, useState } from "preact/hooks"
export default function ChatTalk(props: any) {
  const [Message, setMessage] = useState("")
  if (props.roomid) {
    return (
      <>
        <div class="p-talk-chat">
          <div class="p-talk-chat-container">
            <TalkArea
              roomid={props.roomid}
              ws={props.ws}
              isSelectUser={props.isSelectUser}
              userName={props.userName}
              setWs={props.setWs}
              setSessionid={props.setSessionid}
              setIsChoiceUser={props.setIsChoiceUser}
              setRoomid={props.setRoomid}
            />
            <div class="p-talk-chat-send">
              <form class="p-talk-chat-send__form">
                <div class="p-talk-chat-send__msg">
                  <div class="p-talk-chat-send__dummy" aria-hidden="true">
                  </div>
                  <label>
                    <textarea
                      class="p-talk-chat-send__textarea"
                      placeholder="メッセージを入力"
                      value={Message}
                      onChange={(e) => {
                        if (e.target) {
                          setMessage((e.target as HTMLTextAreaElement).value)
                        }
                      }}
                    >
                    </textarea>
                  </label>
                </div>
                <div
                  class="p-talk-chat-send__file"
                  onClick={async () => {
                    if (Message) {
                      const data = {
                        type: "message",
                        message: Message,
                        roomid: props.roomid,
                        sessionid: props.sessionid,
                      }
                      props.ws.send(JSON.stringify(data))
                      setMessage("")
                    }
                  }}
                >
                  <img src="/ei-send.svg" alt="file" />
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
function TalkArea(props: any) {
  const [roomName, setRoomName] = useState("")
  const [talkData, setTalkData] = useState<TalkDataItem[]>([])
  useEffect(() => {
    setTimeout(() => {
      const chatArea = document.getElementById("chat-area")
      if (chatArea) {
        chatArea.scrollTop = chatArea.scrollHeight
      }
    }, 100)
  }, [talkData])
  useEffect(() => {
    async function getRoom() {
      props.ws?.close()
      const roomid = props.roomid
      const talkdata = await fetch(
        `/api/v1/chats/talkdata?roomid=${roomid}&startChat=true`,
      )
      const talkdatajson = await talkdata.json()
      setRoomName(talkdatajson.roomname)
      const defaultTalkData = talkdatajson.messages.map((data: any) => {
        return {
          type: "message",
          message: data.message,
          time: data.timestamp,
          isRead: true,
          sender: data.sender,
          senderNickName: data.senderNickName,
        }
      })
      //時間順に並び替え
      defaultTalkData.sort((a: any, b: any) => {
        if (a.time < b.time) {
          return -1
        }
        if (a.time > b.time) {
          return 1
        }
        return 0
      })
      setTalkData(defaultTalkData)
      const websocket = new WebSocket(
        "/api/v1/chats/talk" + "?roomid=" + roomid,
      )
      websocket.onopen = () => {
        const data = {
          type: "join",
          roomid: roomid,
        }
        websocket.send(JSON.stringify(data))
      }
      websocket.onmessage = (event) => {
        const data = JSON.parse(event.data)
        if (data.type == "joined") {
          props.setSessionid(data.sessionid)
          return
        }
        if (data.type == "message") {
          setTalkData((prev) => {
            return [
              ...prev,
              {
                type: "message",
                message: data.message,
                time: data.time,
                isRead: false,
                sender: data.userName,
              },
            ]
          })
        }
      }
      props.setWs(websocket)
    }
    if (props.roomid) {
      getRoom()
    }
  }, [props.isSelectUser, props.roomid])
  let SendPrimary = true
  let OtherPrimary = true
  let DateState: Date
  return (
    <>
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
      <div class="p-talk-chat-main" id="chat-area">
        <ul class="p-talk-chat-main__ul">
          {talkData.map((data: any) => {
            //DateStateと日付が同じかどうか UTC+9で判定
            const isEncodeDate = DateState != data.time.split("T")[0]
            DateState = data.time.split("T")[0]
            if (data.type == "message") {
              if (data.sender == props.userName) {
                if (SendPrimary) {
                  SendPrimary = false
                  OtherPrimary = true
                  return (
                    <>
                      {isEncodeDate && (
                        <ChatDate date={data.time.split("T")[0]} />
                      )}
                      <ChatSendMessage
                        message={data.message}
                        time={data.time}
                        isRead={data.isRead}
                        isPrimary={true}
                      />
                    </>
                  )
                }
                return (
                  <>
                    {isEncodeDate && (
                      <ChatDate date={data.time.split("T")[0]} />
                    )}
                    <ChatSendMessage
                      message={data.message}
                      time={data.time}
                      isRead={data.isRead}
                      isPrimary={false}
                    />
                  </>
                )
              } else {
                if (OtherPrimary) {
                  OtherPrimary = false
                  SendPrimary = true
                  return (
                    <>
                      {isEncodeDate && (
                        <ChatDate date={data.time.split("T")[0]} />
                      )}
                      <ChatOtherMessage
                        message={data.message}
                        time={data.time}
                        sender={data.sender}
                        senderNickName={data.senderNickName}
                        isPrimary={true}
                      />
                    </>
                  )
                }
                return (
                  <>
                    {isEncodeDate && (
                      <ChatDate date={data.time.split("T")[0]} />
                    )}
                    <ChatOtherMessage
                      message={data.message}
                      time={data.time}
                      sender={data.sender}
                      senderNickName={data.senderNickName}
                      isPrimary={false} // Add isPrimary prop based on the index of the data
                    />
                  </>
                )
              }
            } else {
              return <ChatDate date={data.date} />
            }
          })}
        </ul>
      </div>
    </>
  )
}
function isDifferentDate(date1, date2) {
  return date1.getFullYear() !== date2.getFullYear() ||
         date1.getMonth() !== date2.getMonth() ||
         date1.getDate() !== date2.getDate();
}