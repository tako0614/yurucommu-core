export default function User(
    { userName, latestMessage, icon, onClick, userName2, isNewMessage },
) {
    let resultLatestMessage
    if (latestMessage.length > 17) {
        resultLatestMessage = latestMessage.substr(0, 17) + "..."
    } else {
        resultLatestMessage = latestMessage
    }
    return (
        <>
            <li class="c-talk-rooms" onClick={isOnClickUndefind(onClick)}>
                <a>
                    <div class="flex">
                        <div class="c-talk-rooms-icon">
                            <img src={icon} />
                        </div>
                        <div class="c-talk-rooms-box">
                            <div class="c-talk-rooms-name flex">
                                <p>{userName}</p>
                                <p class="text-gray-500 ml-2">
                                    {userName2 == undefined ? ("") : userName2}
                                </p>
                            </div>
                            <div class="c-talk-rooms-msg">
                                <p>{resultLatestMessage}</p>
                            </div>
                        </div>
                    </div>
                    {isNewMessage
                        ? (
                            <p class="green ml-auto mt-auto mb-auto rounded-full w-2 h-2 p-2">
                                new!
                            </p>
                        )
                        : ""}
                </a>
            </li>
        </>
    )
}

const isOnClickUndefind = (fn) => {
    if (fn === undefined || fn === null) {
        return () => {}
    }
    return fn
}
