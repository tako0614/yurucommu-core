import rooms from "../../../models/rooms.js"
import Friends from "../../../models/friends.js"
import csrftoken from "../../../models/csrftoken.js"
import { getCookies } from "https://deno.land/std@0.220.1/http/cookie.ts"
export const handler = {
  async POST(req, ctx) {
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
    try {
      const chatRooms = await rooms.find({ users: userName }, {
        latestmessage: 1,
        latestMessageTime: 1,
        types: 1,
        name: 1,
      })
      const friendsInfo = await Friends.findOne({ userName: userName }, {
        friends: 1,
      })
      if (friendsInfo === null || friendsInfo === undefined) {
        return new Response(JSON.stringify({ "status": "You are alone" }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        })
      }
      if (
        chatRooms === null || chatRooms === undefined
      ) {
        return new Response(JSON.stringify({ "status": "You are alone" }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        })
      }
      const result = chatRooms.map((room) => {
        if (room.types === "friend") {
          const foundFriend = friendsInfo.friends.find((friend) => {
            friend.room === room._id
          })
          const friendName = foundFriend.userName
          const result = {
            roomName: friendName,
            lastMessage: room.latestmessage,
            roomID: room._id,
            latestMessageTime: room.latestMessageTime,
          }
          return result
        } else if (room.types === "group") {
          const result = {
            roomName: room.name,
            lastMessage: room.latestmessage,
            roomID: room._id,
          }
          return result
        } else {
          return
        }
      })
      return new Response(
        JSON.stringify({ "status": "success", "chatRooms": result }),
        {
          headers: { "Content-Type": "application/json" },
        },
      )
    } catch (error) {
      console.log(error)
      return new Response(JSON.stringify({ "status": "error" }), {
        headers: { "Content-Type": "application/json" },
        status: 500,
      })
    }
  },
}
