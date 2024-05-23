import { getCookies } from "$std/http/cookie.ts"
import csrftoken from "../../../../models/csrftoken.ts"
import Friends from "../../../../models/friends.ts"
import requestAddFriend from "../../../../models/reqestAddFriend.ts"
import Users from "../../../../models/users.ts"
import rooms from "../../../../models/rooms.ts"
import users from "../../../../models/users.ts"
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
    if (data.type === "rejectRequest") {
      const { friendName } = data
      const friendInfo = await Users.findOne({ userName: friendName }) // Assuming 'userName' is a valid field in the 'users' object
      if (!friendInfo) {
        return new Response(JSON.stringify({ status: "error" }), {
          headers: { "Content-Type": "application/json" },
          status: 403,
        })
      }
      const isRequested = await requestAddFriend.findOne({
        userID: userid,
      })
      if (!isRequested) {
        return new Response(JSON.stringify({ status: "error" }), {
          headers: { "Content-Type": "application/json" },
          status: 403,
        })
      }
      const isRequestedFriend = isRequested.Applicant.some(
        (applicant: any) => applicant.userID === friendInfo._id.toString(),
      )
      if (!isRequestedFriend) {
        return new Response(JSON.stringify({ status: "error" }), {
          headers: { "Content-Type": "application/json" },
          status: 403,
        })
      }
      await requestAddFriend.updateOne(
        { userID: userid },
        { $pull: { Applicant: { userID: friendInfo._id.toString() } } },
      )
      return new Response(JSON.stringify({ status: "success" }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      })
    }
    if (data.type === "acceptRequest") {
      const { friendName } = data
      const friendInfo = await Users.findOne({ userName: friendName })
      if (!friendInfo) {
        return new Response(JSON.stringify({ status: "error" }), {
          headers: { "Content-Type": "application/json" },
          status: 403,
        })
      }
      const isRequested = await requestAddFriend.findOne({
        userID: userid,
      })
      if (!isRequested) {
        return new Response(JSON.stringify({ status: "error" }), {
          headers: { "Content-Type": "application/json" },
          status: 403,
        })
      }
      const isRequestedFriend = isRequested.Applicant.some(
        (applicant: any) => applicant.userID === friendInfo._id.toString(),
      )
      if (!isRequestedFriend) {
        return new Response(JSON.stringify({ status: "error" }), {
          headers: { "Content-Type": "application/json" },
          status: 403,
        })
      }
      const isAlreadyCreateFriendTable = await Friends.findOne({ user: userid })
      if (!isAlreadyCreateFriendTable) {
        await Friends.create({ user: userid })
      }
      await Friends.updateOne(
        { user: userid },
        { $push: { friends: { userid: friendInfo._id } } }, // Assuming 'name' is a valid field in the 'friends' object
      )
      await Friends.updateOne(
        { user: friendInfo._id.toString() },
        { $push: { friends: { userid } } },
      )
      await requestAddFriend.updateOne(
        { userID: userid },
        { $pull: { Applicant: { userID: friendInfo._id.toString() } } },
      )
      //乱数でroomIDを生成
      let isCreatedRoom = false
      let roomID = ""
      while (!isCreatedRoom) {
        roomID = Math.random().toString(32).substring(2)
        const room = await rooms.findOne({ name: roomID })
        if (!room) {
          await rooms.create({
            name: roomID,
            users: [userid, friendInfo._id.toString()],
            messages: [],
            types: "friend",
            latestmessage: "",
            latestMessageTime: Date.now(),
          })
          isCreatedRoom = true
        }
      }
      await users.updateOne(
        { _id: userid },
        { $push: { rooms: roomID } },
      )
      await users.updateOne(
        { _id: friendInfo._id.toString() },
        { $push: { rooms: roomID } },
      )
      return new Response(JSON.stringify({ status: "success" }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      })
    }
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
