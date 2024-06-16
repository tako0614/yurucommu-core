import ChatDate from "../../components/Chats/ChatDate.tsx"
import ChatSendMessage from "../../components/Chats/ChatSendMessage.jsx"
import ChatOtherMessage from "../../components/Chats/ChatOtherMessage.jsx"
export default function ChatTalk(props: any) {
    if (props.isSelectUser) {
        return (
            <>
                <TalkArea
                    roomid={props.roomid}
                    ws={props.ws}
                    isSelectUser={props.isSelectUser}
                    userName={props.userName}
                    setWs={props.setWs}
                    setSessionid={props.setSessionid}
                    setIsChoiceUser={props.setIsChoiceUser}
                    setRoomid={props.setRoomid}
                    roomName={props.roomName}
                    talkData={props.talkData}
                    sessionid={props.sessionid}
                />
            </>
        )
    }
    return (
        <>
            <div class="text-center">
                トークを始めましょう！！
            </div>
        </>
    )
}
function TalkArea(props: any) {
    let SendPrimary = true
    let OtherPrimary = true
    let DateState: any
    return (
        <>
            <div class="p-talk-chat-title">
                <button
                    class="p-talk-chat-prev"
                    onClick={() => {
                        //なぜか送れない
                        props.ws.send(
                            JSON.stringify({
                                type: "leave",
                                sessionid: props.sessionid,
                            }),
                        )
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
                        <title id="chevronLeftIconTitle">Chevron Left</title>
                        {" "}
                        <polyline points="14 18 8 12 14 6 14 6" />
                    </svg>
                </button>
                <p>{props.roomName}</p>
            </div>
            <div class="p-talk-chat-main" id="chat-area">
                <ul class="p-talk-chat-main__ul">
                    {props.talkData.map((data: any) => {
                        const isEncodeDate = new Date(DateState).toLocaleDateString() !== new Date(data.time).toLocaleDateString();
                        DateState = data.time;
                        if (data.type == "message") {
                            if (data.sender == props.userName) {
                                if (SendPrimary) {
                                    SendPrimary = false
                                    OtherPrimary = true
                                    return (
                                        <>
                                            {isEncodeDate && (
                                                <ChatDate
                                                    date={data.time.split(
                                                        "T",
                                                    )[0]}
                                                />
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
                                            <ChatDate
                                                date={data.time.split("T")[0]}
                                            />
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
                                                <ChatDate
                                                    date={data.time.split(
                                                        "T",
                                                    )[0]}
                                                />
                                            )}
                                            <ChatOtherMessage
                                                message={data.message}
                                                time={data.time}
                                                sender={data.sender}
                                                senderNickName={data
                                                    .senderNickName}
                                                isPrimary={true}
                                            />
                                        </>
                                    )
                                }
                                return (
                                    <>
                                        {isEncodeDate && (
                                            <ChatDate
                                                date={data.time.split("T")[0]}
                                            />
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
