import pubClient from "../../../../../util/redisClient.ts"
import { load } from "$std/dotenv/mod.ts"
import messages from "../../../../../models/messages.ts"
import rooms from "../../../../../models/rooms.ts"
import { types } from "https://deno.land/std@0.216.0/media_types/_db.ts"
const env = await load()

export const handler = {
    async POST(req: Request, ctx: any) {
        const data = await req.json()
        const { roomid, messageids, sender, token }: {roomid: string, messageids: [string], sender: string, token: string} = data
        if (
            roomid === "" || roomid === null || roomid === undefined ||
            sender === "" || sender === null || sender === undefined ||
            token === "" || token === null || token === undefined ||
            messageids === null || messageids === undefined
        ) {
            return new Response(JSON.stringify({ status: false }), {
                status: 400,
            })
        }
        const { domain, userName } = splitUserName(sender)
        if(domain !== env["serverDomain"]) {
            return new Response(JSON.stringify({ status: false }), {
                status: 400,
            })
        }
        const isTrueToken = await fetch(
            `http://${domain}/api/v1/server/token?token=` + token,
        )
        if (isTrueToken.status !== 200) {
            return new Response(JSON.stringify({ status: false }), {
                status: 400,
            })
        }
        const isRoomUser = await rooms.findOne({
            uuid: roomid,
            users: { $elemMatch: { userid: sender } },
        })
        if (isRoomUser === null || isRoomUser === undefined) {
            return new Response(JSON.stringify({ status: false }), {
                status: 400,
            })
        }
        const messagesArray = await messages.find({
            roomid,
            messageid: { $in: messageids },
        })
        if (messagesArray.length === 0) {
            return new Response(JSON.stringify({ status: false }), {
                status: 400,
            })
        }
        await messages.updateMany(
            {
                roomid,
                messageid: { $in: messageids },
            },
            {
                $addToSet: { read: { userid: sender } },
            },
        )
        pubClient.publish(
            "takos",
            JSON.stringify({
                types: "read",
                roomid,
                messageids,
                sender,
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
