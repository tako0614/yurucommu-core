import pubClient from "../../../../../util/redisClient.ts"
import { load } from "$std/dotenv/mod.ts"
import messages from "../../../../../models/messages.ts"
import rooms from "../../../../../models/rooms.ts"
import { types } from "https://deno.land/std@0.216.0/media_types/_db.ts"
const env = await load()

export const handler = {
    async POST(req: Request, ctx: any) {
        const data = await req.json()
        const { roomid, messageids, reader, token }: {
            roomid: string
            messageids: [string]
            reader: string
            token: string
        } = data
        if (
            roomid === "" || roomid === null || roomid === undefined ||
            reader === "" || reader === null || reader === undefined ||
            token === "" || token === null || token === undefined ||
            messageids === null || messageids === undefined
        ) {
            return new Response(JSON.stringify({ status: false }), {
                status: 400,
            })
        }
        const { domain, userName } = splitUserName(reader)
        if (domain == env["serverDomain"]) {
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
            users: { $elemMatch: { userid: reader } },
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
        const sender = messagesArray[0].userid
        if (messagesArray.length === 0) {
            return new Response(JSON.stringify({ status: false }), {
                status: 400,
            })
        }
        const messageids2 = messagesArray.map((message) => message.messageid)
        console.log(messageids2)
        await messages.updateMany(
            {
                roomid,
                messageid: { $in: messageids2 },
            },
            {
                $addToSet: { read: { userid: reader } },
            },
        )
        pubClient.publish(
            "takos",
            JSON.stringify({
                type: "read",
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
