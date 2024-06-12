import { load } from "$std/dotenv/mod.ts"
import remoteservers from "../../../../../../models/remoteServers.ts"
import friends from "../../../../../../models/friends.ts"
import users from "../../../../../../models/users.ts"
const env = await load()
export const handler = {
    async GET(req: Request, ctx: any) {
        const { ID } = ctx.params
        const requrl = new URL(req.url)
        const token = requrl.searchParams.get("token") || false
        const reqUser = requrl.searchParams.get("reqUser") || false
        if (ID === undefined || token === false || reqUser === false) {
            return new Response(JSON.stringify({ "status": false }), {
                status: 400,
            })
        }
        const userServerDomain = splitUserName(reqUser).domain
        const userName = splitUserName(reqUser).userName
        if (!userServerDomain || !userName) {
            return new Response(JSON.stringify({ "status": false }), {
                status: 400,
            })
        }
        if (userServerDomain == env["serverDomain"]) {
            return new Response(JSON.stringify({ "status": false }), {
                status: 400,
            })
        }
        const isTrueToken = await fetch(
            `http://${userServerDomain}/api/v1/server/token?token=${token}`,
        )
        //userが存在するか確認
        const user = await users.findOne({ userName: splitUserName(ID).userName })
        if (!user) {
            return new Response(JSON.stringify({ "status": false }), {
                status: 400,
            })
        }
        const serverInfo = await remoteservers.findOne({
            serverDomain: userServerDomain,
            friends: { $elemMatch: { userid: reqUser } },
        })
        if (!serverInfo) {
            return new Response(JSON.stringify({ "status": false }), {
                status: 400,
            })
        }
        if (!isTrueToken) {
            return new Response(JSON.stringify({ "status": false }), {
                status: 400,
            })
        }
        const friendInfo = await friends.findOne({ user: user.uuid })
        if (!friendInfo) {
            return new Response(JSON.stringify({ "status": false }), {
                status: 400,
            })
        }
        const friend = friendInfo.friends.find((friend) =>
            friend.userid === reqUser
        )
        if (!friend) {
            return new Response(JSON.stringify({ "status": false }), {
                status: 400,
            })
        }
        try {
            const result = await Deno.readFile(
                //"../../../../files/userIcons/" + user.uuid + ".webp"
                "./files/userIcons/" + splitUserName(user.uuid).userName +
                    ".webp",
            )
            return new Response(result, {
                headers: { "Content-Type": "image/webp" },
                status: 200,
            })
        } catch (error) {
            console.log(error)
            return new Response("./people.png", {
                headers: { "Content-Type": "application/json" },
                status: 400,
            })
        }
    },
}
function splitUserName(userName: string) {
    const result = {
        userName: userName.split("@")[0],
        domain: userName.split("@")[1],
    }
    return result
}
