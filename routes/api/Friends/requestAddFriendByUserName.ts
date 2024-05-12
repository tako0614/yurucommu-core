import { getCookies } from "$std/http/cookie.ts"
import csrftoken from "../../../models/csrftoken.ts"
import Friends from "../../../models/friends.ts"
import requestAddFriend from "../../../models/reqestAddFriend.ts"
export const handler = {
  async POST(req: Request, ctx: any) {
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
      isAlreadyFriendRequest === null ||
      isAlreadyFriendRequest === undefined
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
