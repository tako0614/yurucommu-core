import redis from "redis"
import rooms from "../../../../models/rooms.ts"
const client = redis.createClient({
  url: "redis://192.168.0.241:6379",
})
await client.connect()
function subscribeMessage(channel) {
  client.subscribe(channel)
  client.on("message", function (_channel, message) {
    broadcast(JSON.parse(message))
  })
}
function broadcast(req) {
  const data = JSON.parse(req)
  sessions.forEach((session) => {
    if (session.roomid === roomid) {
      session.ws.send(JSON.stringify({
        id: id,
        message: data.message,
      }))
    }
  })
}
subscribeMessage("takos")
let sessions = []
export const handler = {
  GET(req, ctx) {
    if (!ctx.state.data.loggedIn) {
      return new Response(JSON.stringify({ "status": "Please Login" }), {
        headers: { "Content-Type": "application/json" },
        status: 401,
      })
    }
    if (req.headers.get("upgrade") === "websocket") {
      if (!socket) throw new Error("unreachable")
      socket.onopen = async (ws, req) => {
        const roomid = requrl.searchParams.get("roomid") || ""
        const isJoiningRoom = await rooms.findOne({
          name: roomid,
          users: ctx.state.data.userid.toString(),
        })
        if (isJoiningRoom === null || isJoiningRoom === undefined) {
          return new Response(
            JSON.stringify({ "status": "You are not in this room" }),
            {
              headers: { "Content-Type": "application/json" },
              status: 401,
            },
          )
        }
        const { socket, _response } = Deno.upgradeWebSocket(req)
        console.log("socket opened")
        sessions.push({
          ws: socket,
          userid: ctx.state.data.userid,
          roomid: roomid,
        })
      }
      socket.onmessage = async (e) => {
        const message = e.data
        redis.publish("newMessage", JSON.stringify(message))
      }
      socket.onclose = (ws) => {
        console.log("socket closed")
        sessions = sessions.filter((session) => session.ws !== ws)
      }
      return response
    } else {
      return new Response(
        JSON.stringify({ response: "the request is a normal HTTP request" }),
      )
    }
  },
}
