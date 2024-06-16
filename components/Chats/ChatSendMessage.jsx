const ChatSendMessage = ({ message, time, isRead, isPrimary }) => {
    const isPrimaryClass = isPrimary
        ? "c-talk-chat self primary"
        : "c-talk-chat self"
    return (
        <li class={isPrimaryClass}>
            <div class="c-talk-chat-box">
                <div class="c-talk-chat-date">
                    {isRead && <p>既読</p>}
                    <p>{convertTime(time)}</p>
                </div>
                <div class="c-talk-chat-right">
                    <div class="c-talk-chat-msg">
                        <p class="">
                            {convertLineBreak(message)}
                        </p>
                    </div>
                </div>
            </div>
        </li>
    )
}
export default ChatSendMessage
function convertTime(time) {
    const date = new Date(time)
    const hours = date.getHours()
    const minutes = date.getMinutes()
    const ampm = hours >= 12 ? "午後" : "午前"
    const hour = hours % 12
    const zeroPaddingHour = hour === 0 ? 12 : hour
    const zeroPaddingMinutes = String(minutes).padStart(2, "0")
    return `${ampm} ${zeroPaddingHour}:${zeroPaddingMinutes}`
}
//preactで動作する改行を反映させるために、改行コードをbrタグに変換する関数
function convertLineBreak(message) {
    if (message === null || message === undefined) return
    return message.split("\n").map((line, index) => (
        <span key={index}>
            {line}
            <br />
        </span>
    ))
}
