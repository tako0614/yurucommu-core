import redis from "redis"
import rooms from "../../../../models/rooms.ts"
import messages from "../../../../models/messages.ts"
import user from "../../../../models/users.ts"
import { load } from "$std/dotenv/mod.ts"
const env = await load()
const redisURL = env["REDIS_URL"]
const pubClient = redis.createClient({
    url: redisURL,
})
await pubClient.connect()
export const handler = {
    async GET(req: Request, ctx: any) {
        if (!ctx.state.data.loggedIn) {
            return new Response(JSON.stringify({ "status": "Please Login" }), {
                headers: { "Content-Type": "application/json" },
                status: 401,
            })
        }
        const requrl = new URL(req.url)
        const roomid = requrl.searchParams.get("roomid")
        if (!roomid) {
            return new Response(
                JSON.stringify({ "status": "Room ID Not Found" }),
                {
                    headers: { "Content-Type": "application/json" },
                    status: 404,
                },
            )
        }
        const startChat = requrl.searchParams.get("startChat") === "true"
        //Start Chatがtrueの場合、roomidの部屋から最新のメッセージを100件取得
        if (startChat) {
            const room = await rooms.findOne({
                uuid: roomid,
            })
            if (!room) {
                return new Response(
                    JSON.stringify({ "status": "Room Not Found" }),
                    {
                        headers: { "Content-Type": "application/json" },
                        status: 404,
                    },
                )
            }
            //最近送信されたメッセージを100件取得
            const RoomMessages = await messages.find({
                roomid: roomid,
            }).sort({ timestamp: -1 }).limit(100)
            if (!RoomMessages) {
                return new Response(
                    JSON.stringify({ "status": "Message Not Found" }),
                    {
                        headers: { "Content-Type": "application/json" },
                        status: 404,
                    },
                )
            }
            let RoomName = ""
            if (room.types === "friend") {
                // ctx.state.data.userid.toString()以外のroom.usersの配列に存在するユーザーのIDを取得
                const friendId = room.users
                    .filter((user: any) =>
                        user.userid !== ctx.state.data.userid
                    )
                    .map((user: any) => user.userid)
                // friendIdのユーザー情報を取得
                const friend = await user.findOne({
                    uuid: friendId[0],
                })
                if (!friend) {
                    return new Response(
                        JSON.stringify({ "status": "Friend Not Found" }),
                        {
                            headers: { "Content-Type": "application/json" },
                            status: 404,
                        },
                    )
                }
                // friendのuserNameを取得
                RoomName = friend.nickName
            } else {
                RoomName = "まだ実装してません"
            }
            const messagesResult = await Promise.all(
                RoomMessages.map(async (message) => {
                    //console.log(message.userid)
                    const sender = await user.findOne({ uuid: message.userid })
                    if (!sender) {
                        return {
                            sender: "Unknown",
                            senderNickName: "Unknown",
                            message: message.message,
                            timestamp: message.timestamp,
                        }
                    }
                    return {
                        sender: sender.userName,
                        senderNickName: sender.nickName,
                        message: message.message,
                        timestamp: message.timestamp,
                    }
                }),
            )
            const result = {
                roomname: RoomName,
                messages: messagesResult,
            }
            return new Response(JSON.stringify(result), {
                headers: { "Content-Type": "application/json" },
            })
        }
    },
}
/**         return {
              sender: senderCache[message.sender].sendername,
              senderNickName: senderCache[message.sender].senderNickName,
              message: message.message,
              timestamp: message.timestamp,
            }
 */
