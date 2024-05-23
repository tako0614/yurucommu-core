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
      <User
        userName="ログアウト"
        latestMessage="ログアウトします"
        icon="./people.webp"
        onClick={() => {
          async function logout() {
            const origin = window.location.origin
            const csrftokenRes = await fetch(
              "/api/v1/csrftoken" + "?origin=" + origin,
            )
            const csrftokenBody = await csrftokenRes.json()
            const csrftoken = csrftokenBody.csrftoken
            console.log(csrftoken)
            await fetch("/api/v1/logins/logout", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                csrftoken: csrftoken,
                reqirments: "logout",
              }),
            })
            window.location.href = "/"
          }
          logout()
        }}
      />
    </>
  )
}
