import User from "../components/Chats/ChatUserList.jsx"
//"p-talk is-inview" : "p-talk"
export default function Setting(props: any) {
  return (
    <>
      <User
        userName="プロフィール"
        latestMessage="プロフィールを編集します"
        icon="./people.webp"
        onClick={() => {
          props.setSettingPage("profile")
          props.setIsChoiceUser(true)
        }}
      />
      <User
        userName="友達"
        latestMessage="ブロックしたりできます"
        icon="./people.webp"
        onClick={() => {
          props.setSettingPage("friends")
          props.setIsChoiceUser(true)
        }}
      />
    </>
  )
}
