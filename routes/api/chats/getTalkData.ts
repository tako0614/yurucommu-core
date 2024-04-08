import room from "../../../models/rooms.js"
export const handler = {
  async POST(req: Request, ctx: any) {
    if (!ctx.state.data.loggedIn) {
      return new Response(JSON.stringify({ "status": "Please Login" }), {
        headers: { "Content-Type": "application/json" },
        status: 401,
      })
    }
    try {
      const data = await req.json()
      const userName = ctx.state.data.userName
      const roomid = data.roomid
      const lastmessagetime: Date = data.lastmessagetime
      const isJoined = await room.findOne({ _id: room }, { users: 1 })
      if (isJoined === null || isJoined === undefined) {
        return new Response(JSON.stringify({ "status": "error" }), {
          headers: { "Content-Type": "application/json" },
          status: 403,
        })
      }
      if (!isJoined.users.includes(userName)) {
        return new Response(JSON.stringify({ "status": "error" }), {
          headers: { "Content-Type": "application/json" },
          status: 403,
        })
      }
      const messages = await room.find({
        _id: roomid,
        "messages.timestamp": { $lte: lastmessagetime, $slice: 30 },
      }, { messages: 1 })
      if (messages === null || messages === undefined) {
        return new Response(JSON.stringify({ "status": "error" }), {
          headers: { "Content-Type": "application/json" },
          status: 403,
        })
      }
      return new Response(JSON.stringify({ "status": true, messages }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      })
    } catch (e) {
      console.error(e)
      return new Response(JSON.stringify({ "status": "error" }), {
        headers: { "Content-Type": "application/json" },
        status: 403,
      })
    }
  },
}
