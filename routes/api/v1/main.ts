import redis from "redis"
import rooms from "../../../models/rooms.ts"
import users from "../../../models/users.ts"
import { load } from "$std/dotenv/mod.ts"
import {crypto} from "$std/crypto/mod.ts"
import messages from "../../../models/messages.ts"
const env = await load()
const redisURL = env["REDIS_URL"]
const subClient = redis.createClient({
    url: redisURL,
})
const pubClient = redis.createClient({
    url: redisURL,
})
subClient.on("error", (err) => console.error("Sub Client Error", err))
pubClient.on("error", (err) => console.error("Pub Client Error", err))

await subClient.connect()
await pubClient.connect()

async function subscribeMessage(channel: string | string[]) {
    await subClient.subscribe(channel, async (message) => {
        const data = JSON.parse(message)
        switch (data.type) {
            case "message":
                sendConecctingUserMessage(data.roomid, data.message)
                break;
            case "refreshFriedList":
                break;
            default:
                break;
        }
    })
}

await subscribeMessage("takos")
const sessions = new Map()

export const handler = {
    async GET(req: Request, ctx: any) {
        if (!ctx.state.data.loggedIn) {
            return new Response(JSON.stringify({ "status": "Please Login" }), {
                headers: { "Content-Type": "application/json" },
                status: 401,
            })
        }
        if (req.headers.get("upgrade") === "websocket") {
            const { socket, response } = Deno.upgradeWebSocket(req)
            socket.onmessage = async function (event) {
                const data = JSON.parse(event.data)
                switch (data.type) {
                    case "joinRoom":
                        joinRoom(data.sessionID, data.roomID, socket)
                        break;
                    case "message":
                        sendMessage(data.sessionID, data.message, data.roomID, socket)
                        break;
                    case "login":
                        login(ctx.state.data.userid, socket)
                        break;
                    default:
                        break;
                }
            }
            socket.onclose = () => {
                console.log("close")
                sessions.forEach((session, key) => {
                    if (session.ws.readyState !== WebSocket.OPEN) {
                        sessions.delete(key)
                    }
                })
            }
            if (!socket) throw new Error("unreachable")
            return response
        } else {
            return new Response(
                JSON.stringify({
                    response: "the request is a normal HTTP request",
                }),
            )
        }
    },
}
async function login(userID: string, ws: WebSocket) {
    const user = await users.findOne({
        uuid: userID,
    })
    if (!user) {
        ws.send(
            JSON.stringify({
                status: false,
                explain: "User Not Found",
            }),
        )
        return
    }
    const sessionID = crypto.randomUUID()
    sessions.set(sessionID, {
        ws,
        uuid: userID,
        talkingRoom: "",
    })
    ws.send(
        JSON.stringify({
            status: true,
            sessionID,
        }),
    )
}
async function joinRoom(sessionID: string, roomID: string, ws: WebSocket) {
    const session = sessions.get(sessionID)
    if (!session) {
        ws.send(
            JSON.stringify({
                status: false,
                explain: "Session Not Found",
            }),
        )
        return
    }
    const room = await rooms.findOne
    ({
        roomid: roomID,
    })
    if (!room) {
        ws.send(
            JSON.stringify({
                status: false,
                explain: "Room Not Found",
            }),
        )
        return
    }
    const isRoomUser = room.users.find((user) => user.userid === session.uuid)
    if (!isRoomUser) {
        ws.send(
            JSON.stringify({
                status: false,
                explain: "You are not in the room",
            }),
        )
        return
    }
    sessions.set(sessionID, {
        ...session,
        talkingRoom: roomID,
    })
    ws.send(
        JSON.stringify({
            status: true,
        }),
    )
}
async function sendMessage(sessionid: string, message: string,roomID: string,ws: WebSocket) {
    const session = sessions.get(sessionid)
    if (!session) {
        ws.send(
            JSON.stringify({
                status: false,
                explain: "Session Not Found",
            }),
        )
        return
    }
    if(session.talkingRoom !== roomID) {
        ws.send(
            JSON.stringify({
                status: false,
                explain: "You are not in the room",
            }),
        )
        return
    }
    await messages.create({
        userid: session.uuid,
        roomid: roomID,
        sender: session.uuid,
        message,
        read: [],
        messageid: crypto.randomUUID(),
    })
    pubClient.publish("takos", JSON.stringify({ roomid: roomID, message,type:"message" }))
    ws.send(
        JSON.stringify({
            status: true,
        }),
    )
}
function sendConecctingUserMessage(roomid: string, message: string) {
    //sessionsにroomidが同じユーザーを探す
    const session = sessions.get(roomid)
    if (!session) {
        return
    }
    session.ws.send(
        JSON.stringify({
            roomid,
            message,
        }),
    )
    return
}