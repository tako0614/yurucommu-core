import { getCookies } from "$std/http/cookie.ts"
import csrftoken from "../../../../models/csrftoken.ts"
import Friends from "../../../../models/friends.ts"
import requestAddFriend from "../../../../models/reqestAddFriend.ts"
import Users from "../../../../models/users.ts"

export const handler = {
  async POST(req: Request, ctx: any) {
    if (!ctx.state.data.loggedIn) {
      return new Response(JSON.stringify({ status: "Please Login" }), {
        headers: { "Content-Type": "application/json" },
        status: 401,
      })
    }

    const data = await req.json()
    const cookies = getCookies(req.headers)

    if (typeof data.csrftoken !== "string") {
      return new Response(JSON.stringify({ status: "error" }), {
        headers: { "Content-Type": "application/json" },
        status: 403,
      })
    }

    const csrfTokenRecord = await csrftoken.findOne({ token: data.csrftoken })
    if (!csrfTokenRecord || csrfTokenRecord.sessionID !== cookies.sessionid) {
      return new Response(JSON.stringify({ status: "error" }), {
        headers: { "Content-Type": "application/json" },
        status: 403,
      })
    }

    await csrftoken.deleteOne({ token: data.csrftoken })
    const userid = ctx.state.data.userid.toString()

    if (data.type === "acceptRequest") {
      // Handle friend request acceptance
    }

    if (data.type === "AddFriendKey") {
      const { addFriendKey } = data
      const addFriendUserInfo = await Users.findOne({
        addFriendKey: addFriendKey,
      })

      if (!addFriendKey || !addFriendUserInfo) {
        return new Response(JSON.stringify({ status: "error" }), {
          headers: { "Content-Type": "application/json" },
          status: 404,
        })
      }

      const friendsInfo = await Friends.findOne({ user: userid })

      if (!friendsInfo) {
        await Friends.create({ user: userid })
      }

      const existingRequest = await requestAddFriend.findOne({
        userID: addFriendUserInfo._id.toString(),
      })

      if (!existingRequest) {
        await requestAddFriend.create({
          userID: addFriendUserInfo._id.toString(),
          Applicant: [{ userID: userid }],
        })
      } else {
        const isAlreadySentReq = existingRequest.Applicant.some(
          (applicant: any) => applicant.userID === userid,
        )

        if (!isAlreadySentReq) {
          await requestAddFriend.updateOne(
            { userID: addFriendUserInfo._id },
            { $push: { Applicant: { userID: userid } } },
          )
        }
      }

      return new Response(JSON.stringify({ status: "success" }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      })
    } else if (data.type === "userName") {
      const userName = ctx.state.data.userName
      const friendName = data.friendName

      const isAlreadyFriend = await Friends.findOne({ userName: userName })
      if (!isAlreadyFriend || isAlreadyFriend.friends.includes(friendName)) {
        return new Response(JSON.stringify({ status: "error" }), {
          headers: { "Content-Type": "application/json" },
          status: 403,
        })
      }

      const friendRequest = await requestAddFriend.findOne({
        userName: friendName,
      })
      if (!friendRequest) {
        return new Response(JSON.stringify({ status: "error" }), {
          headers: { "Content-Type": "application/json" },
          status: 403,
        })
      }

      const isAlreadyRequested = friendRequest.Applicant.some(
        (applicant: any) => applicant.userName === userName,
      )

      if (isAlreadyRequested) {
        return new Response(JSON.stringify({ status: "error" }), {
          headers: { "Content-Type": "application/json" },
          status: 403,
        })
      }

      try {
        await requestAddFriend.updateOne(
          { userName: friendName },
          { $push: { Applicant: { userName: userName } } },
        )

        return new Response(JSON.stringify({ status: "success" }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        })
      } catch (error) {
        console.error(error)
        return new Response(JSON.stringify({ status: "error" }), {
          headers: { "Content-Type": "application/json" },
          status: 500,
        })
      }
    }

    return new Response(JSON.stringify({ status: "error" }), {
      headers: { "Content-Type": "application/json" },
      status: 400,
    })
  },
}
