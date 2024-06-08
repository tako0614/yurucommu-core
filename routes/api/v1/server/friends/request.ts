import users from "../../../../../models/users.ts"
import requestAddFriend from "../../../../../models/reqestAddFriend.ts"
/*
リクエスト元のユーザー名：requesterUsername
リクエスト先のユーザー名：recipientUsername
*/
import { load } from "$std/dotenv/mod.ts"
const env = await load()
export const handler = {
  async POST(req: Request, ctx: any) {
    const data = await req.json()
    const { requirement, token } = data
    if (requirement === "reqFriend") {
      const { requesterUserUUID, recipientUserName, requesterUserName } = data
      if (
        requesterUserUUID === undefined || recipientUserName === undefined ||
        requesterUserName === undefined
      ) {
        return new Response(JSON.stringify({ status: false }), { status: 400 })
      }
      const friendDomain = splitUserName(recipientUserName).domain
      const userDomain = splitUserName(requesterUserName).domain
      if (userDomain == env["serverDomain"] || friendDomain == userDomain) {
        return new Response(JSON.stringify({ status: false }), { status: 400 })
      }
      const isTrueToken = await fetch(
        `http://${userDomain}/api/v1/server/token?token=` + token,
      )
      const isTrueTokenJson = await isTrueToken.json()
      if (isTrueTokenJson.status !== true) {
        return new Response(JSON.stringify({ status: false }), { status: 400 })
      }
      const friendInfo = await users.findOne({
        userName: splitUserName(recipientUserName).userName,
      })
      if (friendInfo === null) {
        return new Response(JSON.stringify({ status: false }), { status: 400 })
      }
      //すでに友達か
      const userFriendInfo = await requestAddFriend.findOne({
        userID: requesterUserUUID,
      })
      if (userFriendInfo !== null) {
        const isFriend = userFriendInfo.Applicant.find((obj) =>
          obj.userID === friendInfo.uuid
        )
        if (isFriend !== undefined) {
          return new Response(JSON.stringify({ status: false }), {
            status: 400,
          })
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
        { userID: friendInfo.uuid },
        {
          $push: {
            Applicant: {
              userID: requesterUserUUID,
              type: "other",
              timestamp: Date.now(),
              host: userDomain,
              userName: requesterUserName,
            },
          },
        },
      )
      if (result === null) {
        return new Response(JSON.stringify({ status: false }), { status: 400 })
      }
      console.log(result)
      return new Response(JSON.stringify({ status: true }), { status: 200 })
    } else if (requirement === "acceptReqFriend") {
      const { requesterUserUUID, recipientUserName, requesterUserName } = data
      if (
        requesterUserUUID === undefined || recipientUserName === undefined ||
        requesterUserName === undefined
      ) {
        return new Response(JSON.stringify({ status: false }), { status: 400 })
      }
      const friendDomain = splitUserName(recipientUserName).domain
      const userDomain = splitUserName(requesterUserName).domain
      if (friendDomain !== userDomain || userDomain !== env["serverDomain"]) {
        return new Response(JSON.stringify({ status: false }), { status: 400 })
      }
      const isTrueToken = await fetch(
        `http://${userDomain}/api/v1/server/token?token=` + token,
      )
      const isTrueTokenJson = await isTrueToken.json()
      if (isTrueTokenJson.status !== true) {
        return new Response(JSON.stringify({ status: false }), { status: 400 })
      }
    }
  },
}
function splitUserName(mail: string) {
  const mailArray = mail.split("@")
  return {
    userName: mailArray[0],
    domain: mailArray[1],
  }
}
