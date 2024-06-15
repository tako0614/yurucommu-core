const ChatDate = ({ date }: { date: Date }) => {
    const currentDate = new Date()
    const chatDate = new Date(date)

    const isToday = chatDate.getDate() === currentDate.getDate()
    const isYesterday = chatDate.getDate() === currentDate.getDate() - 1

    let formattedDate = ""
    if (isToday) {
        formattedDate = "今日"
    } else if (isYesterday) {
        formattedDate = "昨日"
    } else {
        formattedDate = chatDate.toLocaleDateString()
    }

    return (
        <li className="c-talk-date">
            <div className="c-talk-chat-date-box">
                <p>{formattedDate}</p>
            </div>
        </li>
    )
}
export default ChatDate
