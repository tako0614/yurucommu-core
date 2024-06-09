import users from "../../../../../../models/users.ts"
import { load } from "$std/dotenv/mod.ts"
const env = await load()
export const handler = {
  async GET(req: Request, ctx: any) {
    try {
      const { ID } = ctx.params
      const requrl = new URL(req.url)
      const type = requrl.searchParams.get("type") || ""
      const serverDomain = requrl.searchParams.get("serverDomain") || ""
      if (
        ID === undefined || type === "" || type === null ||
        type === undefined || serverDomain === "" || serverDomain === null ||
        serverDomain === undefined
      ) {
        return new Response(JSON.stringify({ "status": false }), {
          status: 400,
        })
      }
      if (type == "id") {
        //
      } else if (type == "addFriendKey") {
        const userInfo = await users.findOne({ addFriendKey: ID })
        if (userInfo == null) {
          return new Response(JSON.stringify({ "status": false }), {
            status: 400,
          })
        }
        const result = {
          userName: userInfo.userName + "@" + env["serverDomain"],
          icon: `https://${env["serverDomain"]}/api/v1/server/friends/${userInfo.uuid}/icon`,
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
