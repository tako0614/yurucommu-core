import { useEffect, useState } from "preact/hooks"
import ChatHeader from "./ChatHeader.tsx"
import ChatList from "./ChatList.jsx"
import ChatTalk from "./ChatTalk.tsx"
import SettingList from "../SettingList.tsx"
import GetAddFriendKey from "./getAddFriendKey.tsx"
import FriendRequest from "./FriendRequest.tsx"
import User from "./AddFriend.tsx"
import RequestFriendById from "./RequestFriendById.tsx"
import messages from "../../models/messages.ts"
type TalkDataItem = {
    type: string
    message: string
    id?: string // idが文字列であると仮定します。必要に応じて適切な型に変更してください。
    time: string
    isRead: boolean
    sender?: string
}
interface FriendList {
    roomName: string
    latestMessage: string
    icon: string
    roomid: string
    userName: string
    isNewMessage: boolean
    latestMessageTime: string | Date
}
export default function Home(
    props: any,
) {
    const [Message, setMessage] = useState("")
    const [page, setPage] = useState(props.page)
    const [isChoiceUser, setIsChoiceUser] = useState(
        props.roomid !== undefined && props.roomid !== "",
    )
    const [roomid, setRoomid] = useState<string | null>(props.roomid)
    const [isShowAddFriendForm, setIsShowAddFriendForm] = useState(
        props.isAddFriendForm,
    )
    const [friendList, setFriendList] = useState<FriendList[]>([])
    const reset = () => {
        //setIsChoiceUser(false)
    }
    const [ws, setWs] = useState<WebSocket | null>(null)
    const [sessionid, setSessionid] = useState("")
    const [roomName, setRoomName] = useState("")
    const [talkData, setTalkData] = useState<TalkDataItem[]>([])
    useEffect(() => {
        if (roomid !== null && roomid !== undefined && roomid !== "") {
            const fetchData = async () => {
                const res = await fetch(
                    `/api/v1/chats/talkdata?roomid=${roomid}&startChat=true`,
                    {
                        method: "GET",
                    },
                )
                const data = await res.json()
                setRoomName(data.roomname)
                const defaultTalkData = data.messages.map((data: any) => {
                    return {
                        type: "message",
                        message: data.message,
                        time: data.timestamp,
                        isRead: data.isRead,
                        sender: data.sender,
                        senderNickName: data.senderNickName,
                        messageid: data.messageid,
                        messageType: data.messageType,
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
            }
            fetchData()
        }
    }, [roomid])
    useEffect(() => {
        setTimeout(() => {
            const chatArea = document.getElementById("chat-area")
            if (chatArea) {
                chatArea.scrollTop = chatArea.scrollHeight
            }
        }, 100)
    }, [talkData])
    useEffect(() => {
        const socket = new WebSocket(
            "/api/v1/main",
        )
        socket.onopen = () => {
            socket.send(
                JSON.stringify({
                    type: "login",
                }),
            )
        }
        socket.onmessage = (event) => {
            const data = JSON.parse(event.data)
            if (data.type == "login") {
                setSessionid(data.sessionID)
                if (props.roomid !== undefined && props.roomid !== "") {
                    socket.send(JSON.stringify({
                        type: "joinRoom",
                        roomid: props.roomid,
                        sessionid: data.sessionID,
                    }))
                }
            } else if (data.type == "joinRoom") {
                setRoomid(data.roomID)
            } else if (data.type == "message") {
                setTalkData((prev) => {
                    return [
                        ...prev,
                        {
                            type: "message",
                            message: data.message,
                            time: data.time,
                            isRead: false,
                            sender: data.sender,
                            senderNickName: data.senderNickName,
                            messageid: data.messageid,
                            messageType: data.messageType,
                        },
                    ]
                })
            } else if (data.type == "read") {
                console.log(data)
                setTalkData((prev) => {
                    return prev.map((item) => {
                        if (data.messageids.includes(item?.message)) {
                            return {
                                ...item,
                                isRead: true,
                            }
                        }
                        return item
                    })
                })
            } else if (data.type == "notification") {
                //friendListを更新
                console.log(data)
                setFriendList((prev) => {
                    const newFriendList = prev.map((item) => {
                        if (item.roomid == data.roomid) {
                            console.log("update")
                            return {
                                ...item,
                                latestMessage: data.message,
                                latestMessageTime: data.time,
                                isNewMessage: true,
                            }
                        }
                        return item
                    })
                    newFriendList.sort((a, b) => {
                        if (a.latestMessageTime < b.latestMessageTime) {
                            return 1
                        }
                        if (a.latestMessageTime > b.latestMessageTime) {
                            return -1
                        }
                        return 0
                    })
                    return newFriendList
                })
            } else {
                if (data.status == false) {
                    console.log(data.explain)
                }
            }
        }
        setWs(socket)
    }, [])
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
                                    ws={ws}
                                    sessionid={sessionid}
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
                    <div class="p-talk-chat">
                        <div class="p-talk-chat-container">
                            <ChatTalk
                                isSelectUser={isChoiceUser}
                                roomid={roomid}
                                setFriendList={setFriendList}
                                setIsChoiceUser={setIsChoiceUser}
                                setRoomid={setRoomid}
                                ws={ws}
                                sessionid={sessionid}
                                setSessionid={setSessionid}
                                userName={props.userName}
                                userNickName={props.userNickName}
                                roomName={roomName}
                                talkData={talkData}
                            />
                            {isChoiceUser && (<>
                            <div class="p-talk-chat-send">
                                <form class="p-talk-chat-send__form">
                                    <div class="p-talk-chat-send__msg">
                                        <div
                                            class="p-talk-chat-send__dummy"
                                            aria-hidden="true"
                                        >
                                        </div>
                                        <label>
                                            <textarea
                                                class="p-talk-chat-send__textarea"
                                                placeholder="メッセージを入力"
                                                value={Message}
                                                onChange={(e) => {
                                                    if (e.target) {
                                                        setMessage(
                                                            (e.target as HTMLTextAreaElement)
                                                                .value,
                                                        )
                                                    }
                                                }}
                                            >
                                            </textarea>
                                        </label>
                                    </div>
                                    <div
                                        class="p-talk-chat-send__file"
                                        onClick={() => {
                                            if (Message) {
                                                if (Message.length > 100) {
                                                    return
                                                }
                                                const data = {
                                                    type: "message",
                                                    message: Message,
                                                    roomid: roomid,
                                                    sessionid: sessionid,
                                                    messageType: "text",
                                                }
                                                ws?.send(JSON.stringify(data))
                                                setMessage("")
                                                // deno-lint-ignore no-explicit-any
                                                setFriendList((prev: any) => {
                                                    // deno-lint-ignore prefer-const
                                                    let temp = prev
                                                    // deno-lint-ignore no-explicit-any
                                                    temp.map((data: any) => {
                                                        if (
                                                            data.roomid ==
                                                                roomid
                                                        ) {
                                                            data.lastMessage =
                                                                Message
                                                            data.latestMessageTime =
                                                                new Date()
                                                                    .toString()
                                                            data.isNewMessage =
                                                                false
                                                        }
                                                    })
                                                    temp.sort(
                                                        (
                                                            a: {
                                                                latestMessageTime:
                                                                    number
                                                            },
                                                            b: {
                                                                latestMessageTime:
                                                                    number
                                                            },
                                                        ) => {
                                                            if (
                                                                a.latestMessageTime <
                                                                    b.latestMessageTime
                                                            ) {
                                                                return 1
                                                            }
                                                            if (
                                                                a.latestMessageTime >
                                                                    b.latestMessageTime
                                                            ) {
                                                                return -1
                                                            }
                                                            return 0
                                                        },
                                                    )
                                                    return temp
                                                })
                                            }
                                        }}
                                    >
                                        <img src="/ei-send.svg" alt="file" />
                                    </div>
                                </form>
                            </div>

                            </>)}
                        </div>
                    </div>
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
                    <RequestFriendById />
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
                                            <div class="text-lg">
                                                {addFriendInfo.data}
                                            </div>
                                            <div class="w-2/3 m-auto mb-10">
                                                <img
                                                    src={"/api/v1/friends/" +
                                                        props.addFriendKey +
                                                        "/icon?isuseAddFriendKey=true"}
                                                    alt=""
                                                    class="rounded-full mx-auto my-5"
                                                />
                                            </div>
                                            <button
                                                onClick={async () => {
                                                    const origin =
                                                        window.location
                                                            .protocol +
                                                        "//" +
                                                        window.location.host
                                                    const csrftokenRes =
                                                        await fetch(
                                                            `/api/v1/csrftoken?origin=${origin}`,
                                                        )
                                                    const csrftoken =
                                                        await csrftokenRes
                                                            .json()
                                                    const result = await fetch(
                                                        "/api/v1/friends/request",
                                                        {
                                                            method: "POST",
                                                            headers: {
                                                                "Content-Type":
                                                                    "application/json",
                                                            },
                                                            body: JSON
                                                                .stringify({
                                                                    csrftoken:
                                                                        csrftoken
                                                                            .csrftoken,
                                                                    type:
                                                                        "AddFriendKey",
                                                                    addFriendKey:
                                                                        props
                                                                            .addFriendKey,
                                                                }),
                                                        },
                                                    )
                                                    const res = await result
                                                        .json()
                                                    if (
                                                        res.status == "success"
                                                    ) {
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
