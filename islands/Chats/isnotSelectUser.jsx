import ChatTitle from "../../components/Chats/ChatTitle.jsx"
import ChatDate from "../../components/Chats/ChatDate.tsx"
import ChatOtherMessages from "../../components/Chats/ChatOtherMessage.jsx"
import ChatSendMessages from "../../components/Chats/ChatSendMessage.jsx"
export default function TalkTimeLine(props) {
  const { userName, friendName } = props

  return (
    <>
      <div class="p-talk-chat-main">
        <ul class="p-talk-chat-main__ul">
          <div class="m-auto text-center">トークを始めよう！</div>
        </ul>
      </div>
    </>
  )
}
