import { useEffect, useState } from "preact/hooks"
import User from "../../components/Chats/ChatUserList.jsx"
export default function ChatList(props) {
  const friendList = props.friendList
  const setFriendList = props.setFriendList
  useEffect(async () => {
    const origin = window.location.protocol + "//" + window.location.host
    const csrftokenres = await fetch(
      `${origin}/api/v1/csrftoken?origin=${origin}`,
    )
    const csrftoken = await csrftokenres.json()
    const result = await fetch(origin + "/api/v1/chats/friendList", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        csrftoken: csrftoken.csrftoken,
      }),
    })
    const res = await result.json()
    if (res.status == "You are alone") {
      setFriendList(
        [
          {
            userName: "友達がいません",
            latestMessage: "友達を追加してみましょう！",
            icon: "/people.png",
          },
        ],
      )
      return
    }
    const friendListTemp = []
    res.chatRooms.map((room) => {
      let lastMessage = room.lastMessage
      if (
        lastMessage === undefined || lastMessage === null ||
        lastMessage === ""
      ) {
        lastMessage = "メッセージがありません"
      }
      const friend = {
        userName: room.roomName,
        latestMessage: lastMessage,
        icon: room.roomIcon,
        roomid: room.roomID,
      }
      friendListTemp.push(friend)
    })
    setFriendList(friendListTemp)
  }, [])
  return (
    <>
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
          <ul class="p-talk-list-rooms__ul">
            {friendList.map((friend) => {
              return (
                <li>
                  <User
                    userName={friend.userName}
                    latestMessage={friend.latestMessage}
                    icon={window.location.protocol + "//" +
                      window.location.host + friend.icon}
                    onClick={() => {
                      window.history.pushState(
                        "",
                        "",
                        "/talk/" + friend.roomid,
                      )
                      props.setIsChoiceUser(true)
                      props.setRoomid(friend.roomid)
                    }}
                  />
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </>
  )
}
const AddFriendForm = (props) => {
  const [addFriendInfo, setAddFriendInfo] = useState([])
  const [isRequested, setIsRequested] = useState(false)
  useEffect(async () => {
    const addFriendKey = props.addFriendKey
    const addFriendInfoTemp = await fetch(
      "/api/v1/friends/" + addFriendKey + "/info",
      {
        method: "GET",
      },
    )
    const res = await addFriendInfoTemp.json()
    setAddFriendInfo(res)
  }, [])
  return (
    <>
      <div class="fixed z-50 w-full h-full overflow-hidden bg-[rgba(75,92,108,0.4)] left-0 top-0">
        <div class="bg-[#f0f0f5] lg:w-1/3 w-full h-full lg:h-4/6 mx-auto lg:my-[6.5%] p-5 lg:rounded-xl">
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
          <div class="w-4/5 mx-auto my-0 text-black">
            <div class="w-full h-full text-center">
              <h1 class="text-3xl mb-10">友達申請を送信する</h1>
              <div class="w-full">
                {!isRequested &&
                  (
                    <>
                      <div class="text-lg">{addFriendInfo.data}</div>
                      <div class="w-2/3 m-auto mb-10">
                        <img
                          src={"/api/v1/friends/" + props.addFriendKey +
                            "/icon?isuseAddFriendKey=true"}
                          alt=""
                          class="rounded-full mx-auto my-5"
                        />
                      </div>
                      <button
                        onClick={async () => {
                          const origin = window.location.protocol + "//" +
                            window.location.host
                          const csrftokenRes = await fetch(
                            `/api/v1/csrftoken?origin=${origin}`,
                          )
                          const csrftoken = await csrftokenRes.json()
                          const result = await fetch(
                            "/api/v1/friends/request",
                            {
                              method: "POST",
                              headers: {
                                "Content-Type": "application/json",
                              },
                              body: JSON.stringify({
                                csrftoken: csrftoken.csrftoken,
                                type: "AddFriendKey",
                                addFriendKey: props.addFriendKey,
                              }),
                            },
                          )
                          const res = await result.json()
                          if (res.status == "success") {
                            //
                            setIsRequested(true)
                          }
                        }}
                        type="submit"
                        class="text-white bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:outline-none focus:ring-blue-300 font-medium rounded-lg text-sm w-full sm:w-auto px-5 py-2.5 text-center dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800"
                      >
                        申請する
                      </button>
                    </>
                  )}
                {isRequested &&
                  (
                    <>
                      <div>
                        そうしんできたで
                      </div>
                    </>
                  )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
