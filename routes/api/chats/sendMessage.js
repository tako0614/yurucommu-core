import rooms from "../../../models/rooms.js"
import messages from "../../../models/messages.js"
import { checksesssionCSRF, isNullorUndefind } from "../../../util/Checker.js"
import csrftoken from "../../../models/csrftoken.js"
import { getCookies } from "https://deno.land/std@0.220.1/http/cookie.ts"
export const handler = {
  async POST(ctx, req) {
    if (!ctx.state.data.loggedIn) {
      return new Response(JSON.stringify({ "status": "Please Login" }), {
        headers: { "Content-Type": "application/json" },
        status: 401,
      })
    }
    const cookies = getCookies(req.headers)
    const data = await req.json()
    if (typeof data.csrftoken !== "string") {
      console.log("aa")
      return { status: false }
    }
    const iscsrfToken = await csrftoken.findOne({ token: data.csrftoken })
    if (iscsrfToken === null || iscsrfToken === undefined) {
      return false
    }
    if (iscsrfToken.sessionID !== cookies.sessionid) {
      return { status: false }
    }
    await csrftoken.deleteOne({ token: data.csrftoken })
    const userName = ctx.state.data.userName
    // send message
    const { room, message } = data
    const roomInfo = await rooms.findOne(
      { _id: room },
      {
        users: 1,
        _id: 0,
        name: 0,
        types: 0,
        latestmessage: 0,
        latestMessageTime: 0,
        messages: 0,
        timestamp: 0,
      },
    )
    if (
      roomInfo === null || roomInfo === undefined ||
      !Array.isArray(roomInfo.users)
    ) {
      return new Response(JSON.stringify({ "status": "error" }), {
        headers: { "Content-Type": "application/json" },
        status: 403,
      })
    }
    const roomMembers = roomInfo.users
    if (roomMembers.includes(userName)) {
      //groupの中にユーザーがいる場合の処理
      const messageData = {
        userName: userName,
        message: message,
      }
      try {
        await messages.create(messageData)
        await rooms.updateOne({ _id: room }, {
          latestmessage: message,
          latestMessageTime: Date.now(),
        })
      } catch (error) {
        console.log(error)
        return new Response(JSON.stringify({ "status": "error" }), {
          headers: { "Content-Type": "application/json" },
          status: 403,
        })
      }
    } else {
      return new Response(JSON.stringify({ "status": "error" }), {
        headers: { "Content-Type": "application/json" },
        status: 403,
      })
    }
  },
}
