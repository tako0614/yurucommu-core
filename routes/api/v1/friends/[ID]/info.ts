import users from "../../../../../models/users.ts"
export const handler = {
  async GET(req: Request, ctx: any) {
    try {
      if (!ctx.state.data.loggedIn) {
        return new Response(
          JSON.stringify({ "status": "Please Login" }),
          {
            headers: { "Content-Type": "application/json" },
            status: 401,
          },
        )
      }
      const { ID } = ctx.params
      if (ID == "") {
        return new Response(
          JSON.stringify({ "status": "No userName" }),
          {
            headers: { "Content-Type": "application/json" },
            status: 400,
          },
        )
      }
      const friendInfo = await users.findOne({
        addFriendKey: ID,
      })
      if (friendInfo == null) {
        return new Response(
          JSON.stringify({ "status": "No such user" }),
          {
            headers: { "Content-Type": "application/json" },
            status: 404,
          },
        )
      }
      return new Response(
        JSON.stringify({
          "status": "success",
          "data": friendInfo.userName,
        }),
        {
          headers: { "Content-Type": "application/json" },
          status: 200,
        },
      )
    } catch (error) {
      console.error("Error in getFriendInfoByID: ", error)
      return new Response(JSON.stringify({ status: "error" }), {
        headers: { "Content-Type": "application/json" },
        status: 500,
      })
    }
  },
}
