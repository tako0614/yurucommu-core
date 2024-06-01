import redis from "redis"
import rooms from "../../../../models/rooms.ts"
import users from "../../../../models/users.ts"
import { load } from "$std/dotenv/mod.ts"
import { session } from "../../../../util/sessions.ts"
import * as mod from "https://deno.land/std@0.224.0/crypto/mod.ts"
const env = await load()
const redisURL = env["REDIS_URL"]
const subClient = redis.createClient({
  url: redisURL,
})
const pubClient = redis.createClient({
  url: redisURL,
})
subClient.on("error", (err) => console.error("Sub Client Error", err))
pubClient.on("error", (err) => console.error("Pub Client Error", err))

await subClient.connect()
await pubClient.connect()

async function subscribeMessage(channel: string | string[]) {
  await subClient.subscribe(channel, async (message) => {
    //さぶすくらいぶからのメッセージを受け取る
  })
}

await subscribeMessage("takos")
const sessions = new Map()

export const handler = {
  async GET(req: Request, ctx: any) {
    if (!ctx.state.data.loggedIn) {
      return new Response(JSON.stringify({ "status": "Please Login" }), {
        headers: { "Content-Type": "application/json" },
        status: 401,
      })
    }
    if (req.headers.get("upgrade") === "websocket") {
      const { socket, response } = Deno.upgradeWebSocket(req)
      socket.onopen = async (event) => {
        //
      }
      socket.onmessage = async function (event) {
        const data = JSON.parse(event.data)
        if (data.type == "join") {
          sessions.forEach((session, key) => {
            if (session.ws.readyState !== WebSocket.OPEN) sessions.delete(key)
          })
          const roomid = data.roomid
          const isJoiningRoom = await rooms.findOne({
            uuid: roomid,
            users: ctx.state.data.userid,
          })
          const userInfo = await users.findOne({ uuid: ctx.state.data.userid })
          if (
            userInfo === null || userInfo === undefined ||
            userInfo.userName == undefined
          ) {
            socket.send(
              JSON.stringify({
                status: false,
                explain: "You are not in the room",
              }),
            )
            return
          }
          if (isJoiningRoom === null || isJoiningRoom === undefined) {
            socket.send(
              JSON.stringify({
                status: false,
                explain: "You are not in the room",
              }),
            )
            return
          }
          const sessionid = crypto.randomUUID()
          sessions.set(sessionid, {
            ws: socket,
            roomid: roomid,
            id: ctx.state.data.userid,
            membersNameChash: {
              [ctx.state.data.userid]: userInfo.userName,
            },
            membersNickNameChash: {
              [ctx.state.data.userid]: userInfo.nickName,
            },
          })
          socket.send(JSON.stringify({ sessionid: sessionid, type: "joined" }))
        }
      }
      socket.onclose = () => {
        console.log("close")
        sessions.forEach((session, key) => {
          if (session.ws.readyState !== WebSocket.OPEN) sessions.delete(key)
        })
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
