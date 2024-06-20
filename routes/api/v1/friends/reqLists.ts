import users from "../../../../models/users.ts"
import RequestAddFriend from "../../../../models/reqestAddFriend.ts"
import { load } from "$std/dotenv/mod.ts"
const env = await load()
export const handler = {
    async GET(req: Request, ctx: any) {
        try {
            if (!ctx.state.data.loggedIn) {
                return new Response(
                    JSON.stringify({ "status": "Please Login" }),
                    {
                        headers: { "Content-Type": "application/json" },
                        status: 401,
                    },
                )
            }
            const userFriendInfo = await RequestAddFriend.findOne({
                userID: ctx.state.data.userid,
            })
            if (userFriendInfo == null) {
                await RequestAddFriend.create({
                    userID: ctx.state.data.userid,
                })
                return new Response(
                    JSON.stringify({ status: true, result: null }),
                    {
                        headers: { "Content-Type": "application/json" },
                        status: 200,
                    },
                )
            }
            const result = await Promise.all(
                userFriendInfo.Applicant.map(
                    async (obj) => {
                        if (obj.type == "local") {
                            const userInfo = await users.findOne({
                                uuid: obj.userID,
                            })
                            if (userInfo == null) {
                                return
                            }
                            return {
                                userName: userInfo.userName + "@" +
                                    env["serverDomain"],
                                icon:
                                    `/api/v1/friends/${userInfo.userName}/icon?isRequestList=true`,
                                timestamp: obj.timestamp,
                            }
                        }
                        if (obj.type == "other") {
                            return {
                                userName: obj.userName + "@" + obj.host,
                                icon: `/people.png`,
                                timestamp: obj.timestamp,
                            }
                        }
                    },
                ),
            )
            if (result == null) {
                return new Response(
                    JSON.stringify({ status: true, result: null }),
                    {
                        headers: { "Content-Type": "application/json" },
                        status: 200,
                    },
                )
            }
            console.log(result)
            return new Response(
                JSON.stringify({ status: true, result: result }),
                {
                    headers: { "Content-Type": "application/json" },
                    status: 200,
                },
            )
        } catch (error) {
            console.error("Error in getFriendInfoByID: ", error)
            return new Response(JSON.stringify({ status: "error" }), {
                headers: { "Content-Type": "application/json" },
                status: 500,
            })
        }
    },
}
