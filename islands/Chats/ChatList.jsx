// deno-lint-ignore-file
import { useEffect, useState } from "preact/hooks"
import { h, render } from "preact"
import User from "../../components/Chats/ChatUserList.jsx"
import SettingList from "../SettingList.tsx"
import re from "https://esm.sh/v135/preact-render-to-string@6.3.1/X-ZS8q/denonext/preact-render-to-string.mjs"
import { isWindows } from "https://deno.land/std@0.216.0/path/_os.ts";
function ChatList(props) {
  if (props.isSetting) {
    return (
      <div class="p-talk-list">
        <h1 class="p-talk-list-title">設定</h1>
        <div class="p-talk-list-rooms">
          <ul class="p-talk-list-rooms__ul" id="friendList">
            <SettingList></SettingList>
          </ul>
        </div>
      </div>
    )
  }
  const [showAddFriendForm, setShowAddFriendForm] = useState(
    props.isAddFriendForm,
  )
  useEffect(async () => {
    const csrftokenres = await fetch(
      "./api/csrfToken?origin=http://localhost:8000",
      {
        method: "GET",
      },
    )
    const csrftoken = await csrftokenres.json()
    const result = await fetch("./api/chats/friendList", {
      method: "POST",
      body: JSON.stringify({
        csrftoken: csrftoken.csrftoken,
      }),
    })
    const res = await result.json()
    if (res.status == "You are alone") {
      const ListElement = document.getElementById("friendList")
      render(
        <User
          userName="友達がいません！！"
          latestMessage="ざぁこ♡ざぁこ♡"
          icon="./people.png"
        />,
        ListElement,
      )
      return
    }
    let ListElement
    result.sort((a, b) => {
      a.latestMessageTime - b.latestMessageTime
    })
    let elements = []
    result.map((friend) => {
      const icon = `./api/friends/getFriendIcon?friendName=${friend.userName}`
      const element = (
        <User
          userName={friend.userName}
          latestMessage={friend.latestMessage}
          icon={icon}
        />
      )
      elements.push(element)
    })
    document.getElementById("friendList").appendChild(user)
    render(elements, ListElement)
  }, [])
  return (
    <>
      {showAddFriendForm && (
        <AddFriendForm
          isAddFriendForm={showAddFriendForm}
          setShowAddFriendForm={setShowAddFriendForm}
          addFriendKey={props.addFriendKey}
        />
      )}
      <div class="p-talk-list">
        <h1 class="p-talk-list-title">トーク</h1>
        <div class="p-talk-list-search">
          <form name="talk-search">
            <label>
              <input
                type="text"
                placeholder="トークルーム・メッセージを検索"
              />
            </label>
          </form>
        </div>
        <div class="p-talk-list-rooms">
          <ul class="p-talk-list-rooms__ul" id="friendList">
            {/**ここにフレンドリストを表示 useEffectでレンダリング */}
          </ul>
        </div>
      </div>
    </>
  )
}
const AddFriendForm = (props) => {
  const [addFriendInfo, setAddFriendInfo] = useState([])
  useEffect(async () => {
    const addFriendKey = props.addFriendKey
    const addFriendInfoTemp = await fetch(
      "./api/Friends/getFriendInfoById?key=" + addFriendKey,
      {
        method: "GET",
      },
    )
    const res = await addFriendInfoTemp.json()
    setAddFriendInfo(res)
  }, [])
  return (
    <>
      <div class="fixed z-50 w-full h-full overflow-hidden bg-[rgba(91,112,131,0.4)] left-0 top-0">
        <div class="bg-[#010005] lg:w-1/3 w-full h-full lg:h-2/3 mx-auto lg:my-[7%] p-5 lg:rounded-xl">
          <div class="flex justify-end bg-blue-500">
            <span
              class="ml-0 text-3xl text-gray-400 font-[bold] no-underline cursor-pointer"
              onClick={() => {
                props.setShowAddFriendForm(false)
                window.history.replaceState("", "", "/")
              }}
            >
              ×
            </span>
          </div>
          <div class="w-4/5 mx-auto my-0 text-white">
            <div class="w-full h-full text-center">
              <h1 class="text-3xl mb-10">友達を追加</h1>
              <div class="w-full bg-gray-700 h-screen">
                <div class="text-lg">{addFriendInfo.data}</div>
                <div class="w-2/3 m-auto mb-10">
                  <img
                    src={"./api/Friends/getFriendIcon?isuseAddFriendKey=true&addFriendKey=" +
                      props.addFriendKey}
                    alt=""
                    class="rounded-full mx-auto my-5"
                  />
                </div>
                <button
                  onClick={async () => {
                    const origin = window.location.protocol + "//" + window.location.host
                    const csrftoken = await fetch(`./api/csrfToken?origin=${origin}`)
                    console.log(csrftoken)
                    const result = await fetch(
                      "./api/Friends/requestAddFriendById",
                      {
                        method: "POST",
                        headers: {
                          "Content-Type": "application/json",
                        },
                        body: JSON.stringify({
                          
                        }),
                      },
                    )
                    const res = await result.json()
                    if(res.status == "success") {
                      //
                      alert("成功したで")
                    }
                  }}
                  type="submit"
                  class="text-white bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:outline-none focus:ring-blue-300 font-medium rounded-lg text-sm w-full sm:w-auto px-5 py-2.5 text-center dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800"
                >
                  申請する
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

export default ChatList
