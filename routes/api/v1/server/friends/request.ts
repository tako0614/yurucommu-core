import users from "../../../../../models/users.ts"
import requestAddFriend from "../../../../../models/reqestAddFriend.ts"
import { load } from "$std/dotenv/mod.ts"
const env = await load()
export const handler = {
    async POST(req: Request, ctx: any) {
        const data = await req.json()
        const { userName, requesterUserUUID,recipientUserName, requirement,token } = data
        //console.log(userName, uuid, requirement,token)
        const domain = splitUserName(requesterUserUUID).domain
        const isTrueToken = await fetch(
            `http://${domain}/api/v1/server/token?token=` + token,
        )
        if (isTrueToken.status !== 200) {
            return new Response(JSON.stringify({ status: false }), { status: 400 })
        }
        if(requirement === "reqFriend") {
            const friendDomain = splitUserName(recipientUserName).domain
            //申請先のユーザーがこのサーバーのユーザーか
            if(friendDomain !== env["serverDomain"]) {
                console.log("friendDomain error")
                return new Response(JSON.stringify({ status: false }), { status: 400 })
            }
            //このサーバーに存在するのか
            const friendInfo = await users.findOne({ userName: splitUserName(recipientUserName).userName })
            if (friendInfo === null) {
                return new Response(JSON.stringify({ status: false }), { status: 400 })
            }
            //すでに友達か
            const userFriendInfo = await requestAddFriend.findOne({
                userID: requesterUserUUID,
            })
            if (userFriendInfo !== null) {
                const isFriend = userFriendInfo.Applicant.find((obj) => obj.userID === friendInfo.uuid)
                if (isFriend !== undefined) {
                    return new Response(JSON.stringify({ status: false }), { status: 400 })
                }
            }
            //申請先のリクエストリストに追加
            const friendRequestInfo = await requestAddFriend.findOne({
                userID: friendInfo.uuid,
            })
            if (friendRequestInfo === null) {
                await requestAddFriend.create({
                    userID: friendInfo.uuid,
                })
            }
            const result = await requestAddFriend.updateOne(
                { userid: friendInfo.uuid },
                { $push: { Applicant: { userID: requesterUserUUID, type: "other", timestamp: Date.now(), host: domain, userName } } },
            )
            if (result === null) {
                return new Response(JSON.stringify({ status: false }), { status: 400 })
            }
            console.log(result)
            return new Response(JSON.stringify({ status: true }), { status: 200 })
        }
    }
}
function splitUserName(mail: string) {
    const mailArray = mail.split("@")
    return {
        userName: mailArray[0],
        domain: mailArray[1],
    }
}