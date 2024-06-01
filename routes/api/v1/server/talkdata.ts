import rooms from "../../../../models/rooms.ts"
import messages from "../../../../models/messages.ts"
export const handler = {
  async POST(req: Request, ctx: any) {
    const data = await req.json()
    const { roomid, token, userName } = data
    const isTrueRoomId = await rooms.findOne({ uuid: roomid })
    if (isTrueRoomId === null || isTrueRoomId === undefined) {
      return new Response("roomid is not found", { status: 400 })
    }
    userName.map(async (sender: string) => {
      checkUserName(sender, isTrueRoomId)
    })
    //userNameのユーザーのドメインがすべて同じか確認
    const domain = splitUserName(userName[0]).domain
    userName.map((sender: string) => {
      const { domain: userDomain } = splitUserName(sender)
      if (userDomain !== domain) {
        return new Response("userName is not found", { status: 400 })
      }
    })
    const isTrueToken = await fetch(
      `https://${domain}/api/v1/server/token?token=${token}`,
    )
    //
    if (isTrueToken.status !== 200) {
      return new Response("token is not found", { status: 400 })
    }
    //roomidとuserNameに対応するメッセージを取得
    const messagesInfo = await messages.find({ roomid })
  },
}
//メールアドレスのドメインと名前を分離
function splitUserName(email: string) {
  const [name, domain] = email.split("@")
  return { name, domain }
}
function checkUserName(userName: string, roomsInfo: any) {
  const { name, domain } = splitUserName(userName)
  const users = roomsInfo.users
  const isTrueUserName = users.find((user: string) => {
    if(users.type === "other") {
    const roomUserName = users.username
    const roomDomain = users.domain
    return roomUserName === name && roomDomain === domain
    } else {
    return false
    }
  })
  return isTrueUserName
}
