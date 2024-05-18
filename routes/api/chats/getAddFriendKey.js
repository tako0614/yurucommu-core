import users from "../../../models/users.ts"
import { crypto } from "$std/crypto/crypto.ts"

export const handler = {
  async GET(req, ctx) {
    const requrl = new URL(req.url)
    const reload = requrl.searchParams.get("reload") || ""
    if (!ctx.state.data.loggedIn) {
      return new Response(JSON.stringify({ "status": false }), {
        headers: { "Content-Type": "application/json" },
        status: 401,
      })
    }
    if (reload == "true") {
      const array = new Uint8Array(16)
      crypto.getRandomValues(array)
      const addFriendKey = Array.from(
        array,
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join("")
      try {
        await users.updateOne({ id: ctx.state.data.userid }, {
          $set: { addFriendKey: addFriendKey },
        })
      } catch (error) {
        console.error(error)
        return new Response(JSON.stringify({ "status": false }), {
          headers: { "Content-Type": "application/json" },
          status: 500,
        })
      }
      return new Response(
        JSON.stringify({ "status": true, addFriendKey: addFriendKey }),
        {
          headers: { "Content-Type": "application/json" },
          status: 200,
        },
      )
    } else if (reload == "false") {
      const userInfo = await users.findOne({
        _id: ctx.state.data.userid,
      })
      if (userInfo === null || userInfo === undefined) {
        return new Response(JSON.stringify({ "status": false }), {
          headers: { "Content-Type": "application/json" },
          status: 500,
        })
      }
      if (
        userInfo.addFriendKey === null ||
        userInfo.addFriendKey === undefined
      ) {
        const array = new Uint8Array(16)
        crypto.getRandomValues(array)
        const addFriendKey = Array.from(
          array,
          (byte) => byte.toString(16).padStart(2, "0"),
        ).join("")
        try {
          await users.updateOne(
            { _id: ctx.state.data.userid },
            {
              $set: { addFriendKey: addFriendKey },
            },
          )
        } catch (error) {
          console.error(error)
          return new Response(JSON.stringify({ "status": false }), {
            headers: { "Content-Type": "application/json" },
            status: 500,
          })
        }
        return new Response(
          JSON.stringify({
            "status": true,
            addFriendKey: addFriendKey,
          }),
          {
            headers: { "Content-Type": "application/json" },
            status: 200,
          },
        )
      } else {
        return new Response(
          JSON.stringify({
            "status": true,
            addFriendKey: userInfo.addFriendKey,
          }),
          {
            headers: { "Content-Type": "application/json" },
            status: 200,
          },
        )
      }
    } else {
      return new Response(JSON.stringify({ "status": "error" }), {
        headers: { "Content-Type": "application/json" },
        status: 403,
      })
    }
  },
}
