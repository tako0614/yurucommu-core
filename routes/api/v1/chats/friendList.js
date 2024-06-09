import rooms from "../../../../models/rooms.ts"
import Friends from "../../../../models/friends.ts"
import csrftoken from "../../../../models/csrftoken.ts"
import users from "../../../../models/users.ts"
import { getCookies } from "$std/http/cookie.ts"
export const handler = {
    async POST(req, ctx) {
        if (!ctx.state.data.loggedIn) {
            return new Response(JSON.stringify({ "status": "Please Login" }), {
                headers: { "Content-Type": "application/json" },
                status: 401,
            })
        }
        const cookies = getCookies(req.headers)
        const data = await req.json()
        if (typeof data.csrftoken !== "string") {
            return { status: false }
        }
        const iscsrfToken = await csrftoken.findOne({ token: data.csrftoken })
        if (iscsrfToken === null || iscsrfToken === undefined) {
            return new Response(
                JSON.stringify({ "status": "csrftoken error" }),
                {
                    headers: { "Content-Type": "application/json" },
                    status: 200,
                },
            )
        }
        if (iscsrfToken.sessionID !== cookies.sessionid) {
            return { status: false }
        }
        await csrftoken.deleteOne({ token: data.csrftoken })
        /*                                                                          */
        try {
            const chatRooms = await rooms.find({
                "users.userid": ctx.state.data.userid,
            })
            const friendsInfo = await Friends.findOne({
                user: ctx.state.data.userid,
            }, {})
            if (friendsInfo === null || friendsInfo === undefined) {
                return new Response(
                    JSON.stringify({ "status": "You are alone" }),
                    {
                        headers: { "Content-Type": "application/json" },
                        status: 200,
                    },
                )
            }
            if (
                chatRooms === null || chatRooms === undefined
            ) {
                return new Response(
                    JSON.stringify({ "status": "You are alone" }),
                    {
                        headers: { "Content-Type": "application/json" },
                        status: 200,
                    },
                )
            }
            if (chatRooms.length === 0) {
                return new Response(
                    JSON.stringify({ "status": "You are alone" }),
                    {
                        headers: { "Content-Type": "application/json" },
                        status: 200,
                    },
                )
            }
            const result = await Promise.all(
                chatRooms.map(async (room) => {
                    if (room.types === "friend") {
                        const friendID = room.users.filter((user) =>
                            user.userid !== ctx.state.data.userid
                        )
                        const friendName = await users.findOne({
                            uuid: friendID[0].userid,
                        })
                        const result = {
                            roomName: friendName.nickName,
                            lastMessage: room.latestmessage,
                            roomID: room.uuid,
                            latestMessageTime: room.latestMessageTime,
                            roomIcon:
                                `/api/v1/friends/${friendName.userName}/icon`,
                            type: "local",
                        }
                        return result
                    } else if (room.types === "group") {
                        const result = {
                            roomName: room.showName,
                            lastMessage: room.latestmessage,
                            roomID: room._id,
                        }
                        return result
                    } else if (room.types === "remotefriend") {
                        console.log(room)
                        const OtherServerUser = room.users.filter((user) =>
                            user.userid !== ctx.state.data.userid
                        )
                        const OtherServerUserDomain = splitUserName(
                            OtherServerUser[0].userid,
                        ).domain
                        const takosTokenArray = new Uint8Array(16)
                        const randomarray = crypto.getRandomValues(takosTokenArray)
                        const takosToken = Array.from(
                            randomarray,
                            (byte) => byte.toString(16).padStart(2, "0"),
                        ).join("")
                        const OtherServerUserInfo = await fetch(`https://${OtherServerUserDomain}/api/v1/server/friends/${OtherServerUser[0].userid}/profile?token=${takosToken}`)
                        const result = {
                            roomName: OtherServerUserInfo.nickName,
                            lastMessage: room.latestmessage,
                            roomID: room.uuid,
                            type: "remote",
                        }
                        return result
                    }
                }),
            )
            console.log(result)
            return new Response(
                JSON.stringify({ "status": "success", "chatRooms": result }),
                {
                    headers: { "Content-Type": "application/json" },
                },
            )
        } catch (error) {
            console.log(error)
            return new Response(JSON.stringify({ "status": "error" }), {
                headers: { "Content-Type": "application/json" },
                status: 500,
            })
        }
    },
}
function splitUserName(userName) {
    const split = userName.split("@")
    return {
        userName: split[0],
        domain: split[1],
    }
}