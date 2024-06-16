import rooms from "../../../../../models/rooms.ts"
import messages from "../../../../../models/messages.ts"
import pubClient from "../../../../../util/redisClient.ts"
import { takosfetch } from "../../../../../util/takosfetch.ts"
import { load } from "$std/dotenv/mod.ts"
const env = await load()
const redisch = env["REDIS_CH"]
const maxMessage = Number(env["MAX_MESSAGE_LENGTH"])
export const handler = {
    async POST(req: Request, ctx: any) {
        const data = await req.json()
        const { roomid, sender, token, message, uuid, messageType, messageid } =
            data
        if (
            roomid === "" || roomid === null || roomid === undefined ||
            sender === "" || sender === null || sender === undefined ||
            token === "" || token === null || token === undefined ||
            message === "" || message === null || message === undefined ||
            uuid === "" || uuid === null || uuid === undefined ||
            messageType === "" || messageType === null ||
            messageType === undefined ||
            messageid === "" || messageid === null || messageid === undefined
        ) {
            return new Response(JSON.stringify({ status: false }), {
                status: 400,
            })
        }
        const { domain, userName } = splitUserName(sender)
        const isTrueToken = await takosfetch(
            `${domain}/api/v1/server/token?token=` + token + "&origin=" + env["serverDomain"],
        )
        if (isTrueToken === null || isTrueToken === undefined) {
            return new Response(JSON.stringify({ status: false }), {
                status: 400,
            })
        }
        if (isTrueToken.status !== 200) {
            return new Response(JSON.stringify({ status: false }), {
                status: 400,
            })
        }
        const room = await rooms.findOne({ uuid: roomid })
        if (room === null || room === undefined) {
            return new Response(JSON.stringify({ status: false }), {
                status: 400,
            })
        }
        const isRoomUser = room.users.find((user) => user.userid === uuid)
        if (isRoomUser === undefined) {
            return new Response(JSON.stringify({ status: false }), {
                status: 400,
            })
        }
        const uuidDomain = splitUserName(uuid).domain
        if (uuidDomain !== domain) {
            return new Response(JSON.stringify({ status: false }), {
                status: 400,
            })
        }
        //messageidがv4のuuidか確認
        if (messageid.length !== 36) {
            return new Response(JSON.stringify({ status: false }), {
                status: 400,
            })
        }
        if(message.length > maxMessage){
            return
        }
        const result = await messages.create({
            userid: uuid,
            roomid,
            sender,
            message,
            read: [],
            messageid,
            messageType,
        })
        pubClient.publish(
            redisch,
            JSON.stringify({
                roomid: roomid,
                message: message,
                type: "message",
                sender: uuid,
                time: result.timestamp,
                messageid,
                messageType,
            }),
        )
        return new Response(JSON.stringify({ status: true }), { status: 200 })
    },
}
function splitUserName(mail: string) {
    const mailArray = mail.split("@")
    return {
        userName: mailArray[0],
        domain: mailArray[1],
    }
}
