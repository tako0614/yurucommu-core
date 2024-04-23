import User from "../components/Chats/ChatUserList.jsx"

export default function Setting() {
  return (
    <>
    <User 
    userName="プロフィール"
    latestMessage="プロフィールを編集します"
    icon="./people.webp"
    />
    <User
    userName="友達"
    latestMessage="ブロックしたりできます"
    icon="./people.webp"
    />
    </>
  )
}
