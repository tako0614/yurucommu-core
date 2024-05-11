import User from "../components/Chats/ChatUserList.jsx"
//"p-talk is-inview" : "p-talk"
export default function Setting() {
  return (
    <>
      <User
        userName="プロフィール"
        latestMessage="プロフィールを編集します"
        icon="./people.webp"
        onClick={() => {
          const chatMainElement = document.getElementById("chatmain")
          if(chatMainElement === null) {
            return
          }
          const test = chatMainElement.className
          if(test == "p-talk") {
            chatMainElement.className = "p-talk is-inview"
            return false
          }
        }}
      />
      <User
        userName="友達"
        latestMessage="ブロックしたりできます"
        icon="./people.webp"
        onClick={() => {
          const chatMainElement = document.getElementById("chatmain")
          if(chatMainElement === null) {
            return
          }
          const test = chatMainElement.className
          if(test == "p-talk") {
            chatMainElement.className = "p-talk is-inview"
            return false
          }
        }}
      />
    </>
  )
}
