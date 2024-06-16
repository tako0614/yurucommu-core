import users from "../../../../../../models/users.ts"
import { load } from "$std/dotenv/mod.ts"
import remoteservers from "../../../../../../models/remoteServers.ts"
import friends from "../../../../../../models/friends.ts"
import { takosfetch } from "../../../../../../util/takosfetch.ts"
const env = await load()
export const handler = {
    async GET(req: Request, ctx: any) {
        try {
            const { ID } = ctx.params
            const requrl = new URL(req.url)
            const type = requrl.searchParams.get("type") || ""
            const SERVER_DOMAIN = requrl.searchParams.get("SERVER_DOMAIN") || ""
            const token = requrl.searchParams.get("token") || false
            if (
                ID === undefined || type === "" || type === null ||
                type === undefined || SERVER_DOMAIN === "" ||
                SERVER_DOMAIN === null ||
                SERVER_DOMAIN === undefined
            ) {
                return new Response(JSON.stringify({ "status": false }), {
                    status: 400,
                })
            }
            if (type == "id") {
                const reqUser = requrl.searchParams.get("reqUser") || false
                if (reqUser === false) {
                    return new Response(JSON.stringify({ "status": false }), {
                        status: 400,
                    })
                }
                if (SERVER_DOMAIN == env["SERVER_DOMAIN"]) {
                    return new Response(JSON.stringify({ "status": false }), {
                        status: 400,
                    })
                }
                if (splitUserName(reqUser).domain !== SERVER_DOMAIN) {
                    return new Response(JSON.stringify({ "status": false }), {
                        status: 400,
                    })
                }
                const isTrueToken = await takosfetch(
                    `${SERVER_DOMAIN}/api/v1/server/token?token=${token}&origin=${env["SERVER_DOMAIN"]}`,
                )
                if (!isTrueToken) {
                    return new Response(JSON.stringify({ "status": false }), {
                        status: 400,
                    })
                }
                const serverInfo = await remoteservers.findOne({
                    SERVER_DOMAIN: SERVER_DOMAIN,
                    friends: { $elemMatch: { userid: reqUser } },
                })
                if (!serverInfo) {
                    return new Response(JSON.stringify({ "status": false }), {
                        status: 400,
                    })
                }
                const friendInfo = await friends.findOne({ user: ID })
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
                const friendUserInfo = await users.findOne({
                    uuid: friendInfo.user,
                })
                if (friendUserInfo == null) {
                    return new Response(JSON.stringify({ "status": false }), {
                        status: 400,
                    })
                }
                const result = {
                    userName: friendUserInfo.userName + "@" +
                        env["SERVER_DOMAIN"],
                    nickName: friendUserInfo.nickName,
                }
                return new Response(
                    JSON.stringify({ "status": true, result: result }),
                    { status: 200 },
                )
            } else if (type == "addFriendKey") {
                const userInfo = await users.findOne({ addFriendKey: ID })
                if (userInfo == null) {
                    return new Response(JSON.stringify({ "status": false }), {
                        status: 400,
                    })
                }
                const result = {
                    userName: userInfo.userName + "@" + env["SERVER_DOMAIN"],
                    nickName: userInfo.nickName,
                }
                return new Response(
                    JSON.stringify({ "status": true, result: result }),
                    { status: 200 },
                )
            }
        } catch (error) {
            console.log("Error in getFriendInfoByID: ", error)
        }
    },
}
function splitUserName(userName: string) {
    const split = userName.split("@")
    return {
        userName: split[0],
        domain: split[1],
    }
}
