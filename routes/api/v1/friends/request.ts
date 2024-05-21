import { getCookies } from "$std/http/cookie.ts"
import csrftoken from "../../../../models/csrftoken.ts"
import Friends from "../../../../models/friends.ts"
import requestAddFriend from "../../../../models/reqestAddFriend.ts"
import Users from "../../../../models/users.ts"
import mongoose from "mongoose"
export const handler = {
  async POST(req: Request, ctx: any) {
    if (!ctx.state.data.loggedIn) {
      return new Response(JSON.stringify({ "status": "Please Login" }), {
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
    const userid = ctx.state.data.userid
    // request add friend
    if(data.type == "acceptRequest") {
      //
      
    }
    if (data.type == "AddFriendKey") {
      const { addFriendKey } = data
      const addFriendUserInfo = await Users.findOne({
        addFriendKey: addFriendKey,
      })
      if (addFriendKey === null || addFriendUserInfo === null) {
        return
      }
      //すでに友達か
      const friendsInfo: any = await Friends.findOne({ user: userid })
      if (friendsInfo !== null) {
        const friends = friendsInfo.friends
        interface FriendsType {
          userid: string
          room: string
          lastMessage: string
        }
        interface SendReqType {
          userName: string
          timestamp: Date
        }
        const isAlredyFriend = friends.some((friend: FriendsType) => {
          friend.userid === addFriendUserInfo._id
        })
        if (isAlredyFriend) {
          return
        }
      } else {
        await Friends.create({ user: userid })
      }
      //すでにリクエストを送っているか
      const requestAddFriendInfo = await requestAddFriend.findOne({
        userID: addFriendUserInfo._id,
      })
      if (requestAddFriendInfo == null) {
        await requestAddFriend.create({
          userID: addFriendUserInfo._id,
        })
      } else {
        const isAlredySendReq = requestAddFriendInfo.Applicant.some(
          (friend: any) => {
            friend.userName === addFriendUserInfo.userName
          },
        )
        if (isAlredySendReq) {
          return
        }
      }
      //await requestAddFriend.findOneAndUpdate({name: 'myname'}, {$set: {phone: '09011112222'}, $push: {reviews: [{rating: 2}]}, $unset: {isDeleted: true} }, {runValidator: true, new: true, projection: 'name phone reviews isDeleted'})
      await requestAddFriend.updateOne({ userID: addFriendUserInfo._id }, {
        $push: {
          Applicant: {
            userID: userid,
          },
        },
      })
      return new Response(JSON.stringify({ status: true }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      })
    } else if (data.type == "userName") {
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
    }
  },
}
