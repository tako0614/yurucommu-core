import { useSignal } from "@preact/signals"
import { useEffect, useState } from "preact/hooks"
import ChatHeader from "./ChatHeader.tsx"
import ChatList from "./ChatList.jsx"
import ChatTalk from "./ChatTalk.tsx"
import Profile from "../Settings/Friends.tsx"
import Friends from "../Settings/Profile.tsx"
import SettingList from "../SettingList.tsx"
import GetAddFriendKey from "./getAddFriendKey.tsx"
import FriendRequest from "./FriendRequest.tsx"
import User from "./AddFriend.tsx"
export default function Home(
  props: any,
) {
  const [page, setPage] = useState(props.page)
  const [isChoiceUser, setIsChoiceUser] = useState(
    props.roomid !== undefined && props.roomid !== "",
  )
  const [roomid, setRoomid] = useState<string | null>(props.roomid)
  const [isShowAddFriendForm, setIsShowAddFriendForm] = useState(
    props.isAddFriendForm,
  )
  const [friendList, setFriendList] = useState([])
  const reset = () => {
    setIsChoiceUser(false)
  }
  const [ws, setWs] = useState<WebSocket | null>(null)
  const [sessionid, setSessionid] = useState("")
  return (
    <>
      {isShowAddFriendForm && (
        <AddFriendForm
          addFriendKey={props.AddFriendKey}
          setShowAddFriendForm={setIsShowAddFriendForm}
        />
      )}
      <ChatHeader
        page={page}
        setPage={setPage}
        reset={reset}
        isChoiceUser={isChoiceUser}
      />

      <div class="wrapper">
        <main
          class={isChoiceUser ? "p-talk is-inview" : "p-talk"}
          id="chatmain"
        >
          {page === 1
            ? (
              <>
                <ChatList
                  friendList={friendList}
                  setFriendList={setFriendList}
                  setIsChoiceUser={setIsChoiceUser}
                  setRoomid={setRoomid}
                />
              </>
            )
            : null}
          {page === 2
            ? (
              <>
                <ChatAddFriendList />
              </>
            )
            : null}
          {page === 3
            ? (
              <>
                <Setting
                  setIsChoiceUser={setIsChoiceUser}
                />
              </>
            )
            : null}
          <ChatTalk
            isSelectUser={isChoiceUser}
            roomid={roomid}
            setFriendList={setFriendList}
            setIsChoiceUser={setIsChoiceUser}
            setRoomid={setRoomid}
            ws={ws}
            setWs={setWs}
            sessionid={sessionid}
            setSessionid={setSessionid}
            userName={props.userName}
            userNickName={props.userNickName}
          />
        </main>
      </div>
    </>
  )
}
const Setting = (props: any) => {
  const [settingPage, setSettingPage] = useState("profile")
  return (
    <>
      <div class="p-talk-list">
        <h1 class="p-talk-list-title">設定</h1>
        <div class="p-talk-list-rooms">
          <ul class="p-talk-list-rooms__ul" id="friendList">
            <SettingList
              setSettingPage={setSettingPage}
              setIsChoiceUser={props.setIsChoiceUser}
            >
            </SettingList>
          </ul>
        </div>
      </div>
    </>
  )
}
function ChatAddFriendList(props: any) {
  return (
    <div class="p-talk-list">
      <h1 class="p-talk-list-title">友達を追加</h1>
      <div class="p-talk-list-rooms">
        <h1 class="text-lg">友達を追加</h1>
        <ul class="p-talk-list-rooms__ul" id="friendList">
          <User
            userName="idで追加"
            latestMessage=""
          />
          <User userName="QRコードで追加" latestMessage="" />
          <GetAddFriendKey></GetAddFriendKey>
        </ul>
      </div>
      <div class="p-talk-list-rooms">
        <h1 class="text-lg">リクエスト</h1>
        <ul class="p-talk-list-rooms__ul" id="friendList">
          <FriendRequest></FriendRequest>
        </ul>
      </div>
    </div>
  )
}
const AddFriendForm = (
  props: {
    addFriendKey: string
    setShowAddFriendForm: (arg0: boolean) => void
  },
) => {
  const [addFriendInfo, setAddFriendInfo] = useState({})
  const [isRequested, setIsRequested] = useState(false)
  useEffect(() => {
    const fetchData = async () => {
      const addFriendKey = props.addFriendKey
      const addFriendInfoTemp = await fetch(
        "/api/v1/friends/" + addFriendKey + "/info",
        {
          method: "GET",
        },
      )
      const res = await addFriendInfoTemp.json()
      setAddFriendInfo(res)
    }
    fetchData()
  }, [])
  return (
    <>
      <div class="fixed z-50 w-full h-full overflow-hidden bg-[rgba(75,92,108,0.4)] left-0 top-0">
        <div class="bg-[#f0f0f5] lg:w-1/3 w-full h-full lg:h-4/6 mx-auto lg:my-[6.5%] p-5 lg:rounded-xl">
          <div class="flex justify-end">
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
