import { getCookies } from "https://deno.land/std@0.220.1/http/cookie.ts"
import csrftoken from "../../../models/csrftoken.js"
import Friends from "../../../models/friends.js"
import requestAddFriend from "../../../models/reqestAddFriend.js"
export const handler = {
  async POST(req: Request,ctx: any) {
    if (!ctx.state.data.loggedIn) {
      return new Response(JSON.stringify({ "status": "Please Login" }), {
        headers: { "Content-Type": "application/json" },
        status: 401,
      })
    }
    const cookies = getCookies(req.headers)
    const data = await req.json()
    if (typeof data.csrftoken !== "string") {
      return new Response(JSON.stringify({ status: "error" }), {
        headers: { "Content-Type": "application/json" },
        status: 403,
      })
    }
    const iscsrfToken = await csrftoken.findOne({ token: data.csrftoken })
    if (iscsrfToken === null || iscsrfToken === undefined) {
      return new Response(JSON.stringify({ status: "error" }), {
        headers: { "Content-Type": "application/json" },
        status: 403,
      })
    }
    if (iscsrfToken.sessionID !== cookies.sessionid) {
      return new Response(JSON.stringify({ status: "error" }), {
        headers: { "Content-Type": "application/json" },
        status: 403,
      })
    }
    await csrftoken.deleteOne({ token: data.csrftoken })
    const userName = ctx.state.data.userName
    // request add friend
  },
}
