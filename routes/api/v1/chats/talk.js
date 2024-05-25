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
let sessions = new Map()
export const handler = {
  async GET(req, ctx) {
    if (!ctx.state.data.loggedIn) {
      return new Response(JSON.stringify({ "status": "Please Login" }), {
        headers: { "Content-Type": "application/json" },
        status: 401,
      })
    }
    if (req.headers.get("upgrade") === "websocket") {
      console.log("socket opened")
      const { socket, response } = Deno.upgradeWebSocket(req)
      socket.onopen = async (socket, req) => {
        console.log("socket opened")
      }
      socket.onmessage = async function (event) {
        const data = JSON.parse(event.data)
        if (data.type == "join") {
          const roomid = data.roomid
          const isJoiningRoom = await rooms.findOne({
            name: roomid,
            users: ctx.state.data.userid.toString(),
          })
          if (isJoiningRoom === null || isJoiningRoom === undefined) {
            socket.send(
              JSON.stringify({
                status: false,
                explain: "You are not in the room",
              }),
            )
            return
          }
          //console.log(isJoiningRoom)
          const sessionid = generateSessionId()
          sessions.set(sessionid, {
            ws: socket,
            roomid: roomid,
            id: ctx.state.data.userid.toString(),
          })
          socket.send(JSON.stringify({ sessionid: sessionid, type: "joined" }))
        }
        if (data.type == "message") {
          const roomid = data.roomid
          const session = sessions.get(data.sessionid)
          if (session === undefined) {
            socket.send(
              JSON.stringify({
                status: false,
                explain: "You are not in the room",
              }),
            )
            return
          }
          if (session.roomid !== roomid) {
            socket.send(
              JSON.stringify({
                status: false,
                explain: "You are not in the room",
              }),
            )
            return
          }
          const result = {
            sessionid: data.sessionid,
            type: "message",
            message: data.message,
          }
          redis.publish("takos", JSON.stringify(result))
          socket.send(JSON.stringify({ status: true }))
        }
      }
      socket.onclose = (ws) => {
        console.log("socket closed")
      }
      if (!socket) throw new Error("unreachable")
      return response
    } else {
      return new Response(
        JSON.stringify({ response: "the request is a normal HTTP request" }),
      )
    }
  },
}
function generateSessionId() {
  const array = new Uint8Array(40)
  window.crypto.getRandomValues(array)
  return Array.from(array).map((b) => b.toString(16).padStart(2, "0")).join("")
}
