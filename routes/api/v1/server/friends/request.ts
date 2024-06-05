import externalUsers from "../../../../../models/externalUsers.ts"
import users from "../../../../../models/users.ts"
import requestAddFriend from "../../../../../models/reqestAddFriend.ts"
import { load } from "$std/dotenv/mod.ts"
const env = await load()
export const handler = {
    async POST(req: Request, ctx: any) {
        const data = await req.json()
        const { userid, uuid, requirement,token } = data
        console.log(userid)
        const domain = splitUserName(uuid).domain
        const isTrueToken = await fetch(
            `http://${domain}/api/v1/server/token?token=` + token,
        )
        if (isTrueToken.status !== 200) {
            return new Response(JSON.stringify({ status: false }), { status: 400 })
        }
        const isAlredyAuth = await externalUsers.findOne({ uuid })
        if (isAlredyAuth === null || isAlredyAuth === undefined) {
            await externalUsers.create({ uuid: uuid, domain, userName: userid })
        }
        if(requirement === "reqFriend") {
            const { friendName } = data
            const friendDomain = splitUserName(friendName).domain
            //申請先のユーザーがこのサーバーのユーザーか
            if(friendDomain !== env["serverDomain"]) {
                return new Response(JSON.stringify({ status: false }), { status: 400 })
            }
            //このサーバーに存在するのか
            const friendInfo = await users.findOne({ userName: splitUserName(friendName).userName })
            if (friendInfo === null) {
                return new Response(JSON.stringify({ status: false }), { status: 400 })
            }
            //すでに友達か
            const userFriendInfo = await requestAddFriend.findOne({
                userID: uuid,
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
            await requestAddFriend.updateOne(
                { userid: friendInfo.uuid },
                { $push: { Applicant: { userID: uuid, type: "external", timestamp: Date.now() } } },
            )
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