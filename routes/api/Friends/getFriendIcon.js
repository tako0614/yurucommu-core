import csrftoken from "../../../models/csrftoken.js"
import { getCookies } from "https://deno.land/std@0.220.1/http/cookie.ts"
import users from "../../../models/users.js"
import friends from "../../../models/friends.js"
export const handler = {
  async GET(req, ctx) {
    if (!ctx.state.data.loggedIn) {
      return new Response(JSON.stringify({ "status": "Please Login" }), {
        headers: { "Content-Type": "application/json" },
        status: 401,
      })
    }
    const userName = ctx.data.userName
    const friendName = url.searchParams.get("friendName") || ""
    const isuseAddFriendKey = url.searchParams.get("isuseAddFriendKey") || ""
    if(isuseAddFriendKey == "true"){
      const addFriendKey = url.searchParams.get("addFriendKey") || ""
      if(addFriendKey == ""){
        return new Response(JSON.stringify({ "status": "No addFriendKey" }), {
          headers: { "Content-Type": "application/json" },
          status: 400,
        })
      }
      const user = await users.findOne({ userName:  addFriendKey})
      if(user == null){
        return new Response(JSON.stringify({ "status": "No such user" }), {
          headers: { "Content-Type": "application/json" },
          status: 400,
        })
      }
      const friend = await friends.findOne({ userName: userName })
      if(friend == null){
        return new Response(JSON.stringify({ "status": "You are alone" }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        })
      }
      try {
        const result = await Deno.readFile(
          "../../files/userIcons/" + friend._id + ".webp",
        )
        return new Response(result, {
          headers: { "Content-Type": "image/webp" },
          status: 200,
        })
      } catch (error) {
        console.log(error)
        return new Response("./people.png", {
          headers: { "Content-Type": "application/json" },
          status: 400,
        })
      }
    }
    if (friendName == "") {
      return new Response(JSON.stringify({ "status": "No userName" }), {
        headers: { "Content-Type": "application/json" },
        status: 400,
      })
    }
    const friends = await friends.find({ userName: userName })
    if (friends == null) {
      return new Response(JSON.stringify({ "status": "You are alone" }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      })
    }
    if (
      friends.friends.find((friend) => friend.userName == friendName) == null
    ) {
      return new Response(JSON.stringify({ "status": "No such friend" }), {
        headers: { "Content-Type": "application/json" },
        status: 400,
      })
    }
    try {
      const result = await Deno.readFile(
        "../../files/userIcons/" + friendName + ".webp",
      )
      return new Response(result, {
        headers: { "Content-Type": "image/webp" },
        status: 200,
      })
    } catch (error) {
      console.log(error)
      return new Response("./people.png", {
        headers: { "Content-Type": "application/json" },
        status: 400,
      })
    }
  },
}
