import { getCookies } from "$std/http/cookie.ts"
import csrftoken from "../../../../models/csrftoken.ts"
import Friends from "../../../../models/friends.ts"
import requestAddFriend from "../../../../models/reqestAddFriend.ts"
import Users from "../../../../models/users.ts"
import rooms from "../../../../models/rooms.ts"
import users from "../../../../models/users.ts"
import { load } from "$std/dotenv/mod.ts"
const env = await load()
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
    const userid = ctx.state.data.userid
    if (data.type === "rejectRequest") {
      const { friendName } = data
      console.log(friendName)
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
        (applicant: any) => applicant.userID === friendInfo.uuid,
      )
      if (!isRequestedFriend) {
        return new Response(JSON.stringify({ status: "error" }), {
          headers: { "Content-Type": "application/json" },
          status: 403,
        })
      }
      await requestAddFriend.updateOne(
        { userID: userid },
        { $pull: { Applicant: { userID: friendInfo.uuid } } },
      )
      return new Response(JSON.stringify({ status: "success" }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      })
    }
    if (data.type === "acceptRequest") {
      const { friendName } = data
      console.log(friendName)
      const splitFriendName = splitUserName(friendName)
      if (!splitFriendName || splitFriendName.domain !== env["serverDomain"]) {
        console.log("Not local user")
        //Other server's user
        return
      }
      const friendInfo = await Users.findOne({ userName: splitFriendName.name })
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
        (applicant: any) => applicant.userID === friendInfo.uuid,
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
        { $push: { friends: { userid: friendInfo.uuid } } }, // Assuming 'name' is a valid field in the 'friends' object
      )
      await Friends.updateOne(
        { user: friendInfo.uuid },
        { $push: { friends: { userid } } },
      )
      await requestAddFriend.updateOne(
        { userID: userid },
        { $pull: { Applicant: { userID: friendInfo.uuid } } },
      )
      await requestAddFriend.updateOne(
        { userID: friendInfo.uuid },
        { $pull: { AppliedUser: { userID: userid } } },
      )
      //乱数でroomIDを生成
      let isCreatedRoom = false
      let roomID = ""
      while (!isCreatedRoom) {
        roomID = Math.random().toString(32).substring(2)
        const room = await rooms.findOne({ uuid: roomID })
        if (!room) {
          await rooms.create({
            uuid: roomID,
            users: [
              {
                username: userid,
                userid: userid,
                host: "local",
                type: "local",
                domain: env["serverDomain"],
              },
              {
                username: friendInfo.userName,
                userid: friendInfo.uuid,
                host: "local",
                type: "local",
                domain: "local",
              },
            ],
            messages: [],
            types: "friend",
            latestmessage: "",
            latestMessageTime: Date.now(),
          })
          isCreatedRoom = true
        }
      }
      await users.updateOne(
        { uuid: userid },
        { $push: { rooms: roomID } },
      )
      await users.updateOne(
        { uuid: friendInfo.uuid },
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
    // only local user can add friend by key
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
        userID: addFriendUserInfo.uuid,
      })
      const ApplcienterInfo = await Users.findOne({ uuid: userid })
      if (!ApplcienterInfo) {
        return new Response(JSON.stringify({ status: "error" }), {
          headers: { "Content-Type": "application/json" },
          status: 404,
        })
      }
      if (!existingRequest) {
        await requestAddFriend.create({
          userID: addFriendUserInfo.uuid,
          Applicant: [{
            userID: userid,
            userName: ApplcienterInfo.userName,
            host: env["serverDomain"],
            type: "local",
          }],
        })
        await requestAddFriend.create({
          userID: userid,
          Applicant: [],
          AppliedUser: [{
            userID: addFriendUserInfo.uuid,
            userName: addFriendUserInfo.userName,
            host: env["serverDomain"],
            type: "local",
          }],
        })
      } else {
        const isAlreadySentReq = existingRequest.Applicant.some(
          (applicant: any) => applicant.userID === userid,
        )

        if (!isAlreadySentReq) {
          await requestAddFriend.updateOne(
            { userID: addFriendUserInfo.uuid },
            {
              $push: {
                Applicant: { userID: userid },
                AppliedUser: { userID: addFriendUserInfo.uuid },
              },
            },
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
      const firendInfo = await Users.findOne({ userName: friendName })
      if (!firendInfo) {
        return new Response(JSON.stringify({ status: "error" }), {
          headers: { "Content-Type": "application/json" },
          status: 404,
        })
      }
      const friendNameSplit = splitUserName(friendName)
      const serverDomain = env["serverDomain"]
      if (!friendNameSplit || friendNameSplit.domain !== serverDomain) {
        return new Response(JSON.stringify({ status: "error" }), {
          headers: { "Content-Type": "application/json" },
          status: 403,
        })
      }
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
          { userID: firendInfo.uuid},
          {
            $push: {
              Applicant: {
                userName: userName,
                userid: userid,
                type: "local",
                host: env["serverDomain"],
              },
            },
          },
        )
        await requestAddFriend.updateOne(
          { userID: userid },
          {
            $push: {
              AppliedUser: {
                userName: friendName,
                type: "local",
                host: friendNameSplit.domain,
                userid: firendInfo.uuid,
              },
            },
          },
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
function splitUserName(name: string) {
  const parts = name.split("@")
  if (parts.length === 2) {
    return { name: parts[0], domain: parts[1] }
  } else {
    return null
  }
}
