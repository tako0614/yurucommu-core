import { getCookies } from "https://deno.land/std@0.220.1/http/cookie.ts"
import sessionID from "../../../models/sessionid.js"
import csrftoken from "../../../models/csrftoken.js"
import Friends from "../../../models/friends.js"
import requestAddFriend from "../../../models/reqestAddFriend.js"
import { RequestAddFriendById } from "../../../util/ResponseTypes.ts"
export const handler = {
  async post(ctx: any, req: Request) {
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
      return false
    }
    if (iscsrfToken.sessionID !== cookies.sessionid) {
      return { status: false }
    }
    await csrftoken.deleteOne({ token: data.csrftoken })
    const userName = ctx.state.data.userName
    // request add friend
    const friendName = data.friendName
    //すでに友達かどうか
    const isAlreadyFriend = await Friends.findOne({ userName: userName })
    if (isAlreadyFriend === null || isAlreadyFriend === undefined) {
      return new Response(JSON.stringify({ status: "error" }), {
        headers: { "Content-Type": "application/json" },
        status: 403,
      })
    }
    if (isAlreadyFriend.friends.includes(friendName)) {
      return new Response(JSON.stringify({ status: "error" }), {
        headers: { "Content-Type": "application/json" },
        status: 403,
      })
    }
    //すでにリクエストを送っているかどうか
    const isAlreadyFriendRequest = await requestAddFriend.findOne({
      userName: friendName,
    })
    if (
      isAlreadyFriendRequest === null || isAlreadyFriendRequest === undefined
    ) {
      return new Response(JSON.stringify({ status: "error" }), {
        headers: { "Content-Type": "application/json" },
        status: 403,
      })
    }
    const isAlreadyRequest = isAlreadyFriendRequest.Applicant.find(
      (applicant: any) => {
        applicant.userName === userName
      },
    )
    if (isAlreadyRequest !== null || isAlreadyRequest !== undefined) {
      return new Response(JSON.stringify({ status: "error" }), {
        headers: { "Content-Type": "application/json" },
        status: 403,
      })
    }
    //リクエストを送る
    try {
      await requestAddFriend.updateOne(
        { userName: friendName },
        { $push: { Applicant: { userName: userName } } },
      )
    } catch (error) {
      console.log(error)
      return new Response(JSON.stringify({ status: "error" }), {
        headers: { "Content-Type": "application/json" },
        status: 403,
      })
    }
    return new Response(JSON.stringify({ status: "success" }), {
      headers: { "Content-Type": "application/json" },
    })
  },
}
