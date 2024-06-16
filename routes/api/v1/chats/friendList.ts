import rooms from "../../../../models/rooms.ts"
import Friends from "../../../../models/friends.ts"
import csrftoken from "../../../../models/csrftoken.ts"
import users from "../../../../models/users.ts"
import { getCookies } from "$std/http/cookie.ts"
import { load } from "$std/dotenv/mod.ts"
import messages from "../../../../models/messages.ts"
const env = await load()
import { takosfetch } from "../../../../util/takosfetch.ts"

interface Context {
    state: {
        data: {
            loggedIn: boolean
            userid: string
        }
    }
}

interface User {
    userid: string
}

interface Friend {
    user: string
}

interface RequestData {
    csrftoken: string
}

export const handler = {
    async POST(req: Request, ctx: Context): Promise<Response> {
        if (!ctx.state.data.loggedIn) {
            return new Response(JSON.stringify({ status: "Please Login" }), {
                headers: { "Content-Type": "application/json" },
                status: 401,
            })
        }

        const cookies = getCookies(req.headers)
        const data: RequestData = await req.json()

        if (typeof data.csrftoken !== "string") {
            return new Response(JSON.stringify({ status: false }), {
                headers: { "Content-Type": "application/json" },
                status: 400,
            })
        }

        const iscsrfToken = await csrftoken.findOne({ token: data.csrftoken })
        if (iscsrfToken === null || iscsrfToken === undefined) {
            return new Response(JSON.stringify({ status: "csrftoken error" }), {
                headers: { "Content-Type": "application/json" },
                status: 200,
            })
        }

        if (iscsrfToken.sessionID !== cookies.sessionid) {
            return new Response(JSON.stringify({ status: false }), {
                headers: { "Content-Type": "application/json" },
                status: 400,
            })
        }

        await csrftoken.deleteOne({ token: data.csrftoken })

        try {
            const chatRooms = await rooms.find({
                "users.userid": ctx.state.data.userid,
            })
            const friendsInfo = await Friends.findOne({
                user: ctx.state.data.userid,
            })

            if (friendsInfo === null || friendsInfo === undefined) {
                return new Response(
                    JSON.stringify({ status: "You are alone" }),
                    {
                        headers: { "Content-Type": "application/json" },
                        status: 200,
                    },
                )
            }

            if (
                chatRooms === null || chatRooms === undefined ||
                chatRooms.length === 0
            ) {
                return new Response(
                    JSON.stringify({ status: "You are alone" }),
                    {
                        headers: { "Content-Type": "application/json" },
                        status: 200,
                    },
                )
            }

            const result = await Promise.all(
                chatRooms.map(async (room: any) => {
                    if (room.types === "friend") {
                        const friendID = room.users.filter(
                            (user: { userid: string }) =>
                                user.userid !== ctx.state.data.userid,
                        )
                        const friendName = await users.findOne({
                            uuid: friendID[0].userid,
                        })
                        const latestmessage = await messages.findOne({
                            roomid: room.uuid,
                        }).sort({ timestamp: -1 })
                        const isNewMessage = latestmessage?.read.find(
                            (read: User) =>
                                read.userid === ctx.state.data.userid,
                        )
                        const friendResult = {
                            roomName: friendName?.nickName,
                            lastMessage: latestmessage?.message,
                            roomID: room.uuid,
                            latestMessageTime: latestmessage?.timestamp,
                            roomIcon: `/api/v1/friends/${
                                friendName?.userName + "@" +
                                env["serverDomain"]
                            }/icon`,
                            type: "localfriend",
                            userName: friendName?.userName + "@" +
                                env["serverDomain"],
                            isNewMessage: isNewMessage === undefined,
                        }
                        return friendResult
                    } else if (room.types === "group") {
                        const groupResult = {
                            roomName: room.showName,
                            lastMessage: room.latestmessage,
                            roomID: room._id,
                        }
                        return groupResult
                    } else if (room.types === "remotefriend") {
                        const OtherServerUser = room.users.filter(
                            (user: { userid: string }) =>
                                user.userid !== ctx.state.data.userid,
                        )
                        const OtherServerUserDomain = splitUserName(
                            OtherServerUser[0].userid,
                        ).domain

                        const takosTokenArray = new Uint8Array(16)
                        const randomarray = crypto.getRandomValues(
                            takosTokenArray,
                        )
                        const takosToken = Array.from(
                            randomarray,
                            (byte) => byte.toString(16).padStart(2, "0"),
                        ).join("")

                        const OtherServerUserInfo = await takosfetch(
                            `${OtherServerUserDomain}/api/v1/server/friends/${
                                OtherServerUser[0].userid
                            }/profile?token=${takosToken}&serverDomain=${
                                env["serverDomain"]
                            }&type=id&reqUser=${ctx.state.data.userid}`,
                        )
                        console.log(OtherServerUserInfo.url)
                        console.log("")
                        if (!OtherServerUserInfo) {
                            const remoteErrorResult = {
                                roomName: "remote server error",
                                lastMessage: room.latestmessage,
                                roomID: room.uuid,
                                type: "remotefriend",
                            }
                            return remoteErrorResult
                        }
                        let OtherServerUserInfoJson
                        try {
                            OtherServerUserInfoJson = await OtherServerUserInfo
                                .json()
                        } catch (_e) {
                            OtherServerUserInfoJson = {
                                status: false,
                            }
                        }
                        const latestmessage = await messages.findOne({
                            roomid: room.uuid,
                        }).sort({ timestamp: -1 })
                        const isNewMessage = latestmessage?.read.find(
                            (read: User) =>
                                read.userid === ctx.state.data.userid,
                        )
                        if (OtherServerUserInfoJson.status === true) {
                            const remoteFriendResult = {
                                roomName:
                                    OtherServerUserInfoJson.result.nickName,
                                lastMessage: latestmessage?.message,
                                roomID: room.uuid,
                                type: "remotefriend",
                                roomIcon:
                                    `/api/v1/friends/${OtherServerUserInfoJson.result.userName}/icon`,
                                userName:
                                    OtherServerUserInfoJson.result.userName,
                                isNewMessage: isNewMessage === undefined,
                                latestMessageTime: latestmessage?.timestamp,
                            }
                            return remoteFriendResult
                        } else {
                            const remoteErrorResult = {
                                roomName: "remote server error",
                                lastMessage: room.latestmessage,
                                roomID: room.uuid,
                                type: "remotefriend",
                            }
                            return remoteErrorResult
                        }
                    }
                }),
            )

            return new Response(
                JSON.stringify({ status: "success", chatRooms: result }),
                {
                    headers: { "Content-Type": "application/json" },
                },
            )
        } catch (error) {
            console.log(error)
            return new Response(JSON.stringify({ status: "error" }), {
                headers: { "Content-Type": "application/json" },
                status: 500,
            })
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
