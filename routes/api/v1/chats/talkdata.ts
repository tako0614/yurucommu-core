import redis from "redis"
import rooms from "../../../../models/rooms.ts"
import user from "../../../../models/users.ts"
import { load } from "$std/dotenv/mod.ts"
const env = await load()
const redisURL = env["REDIS_URL"]
const pubClient = redis.createClient({
  url: redisURL,
})
await pubClient.connect()
export const handler = {
  async GET(req: Request, ctx: any) {
    if (!ctx.state.data.loggedIn) {
      return new Response(JSON.stringify({ "status": "Please Login" }), {
        headers: { "Content-Type": "application/json" },
        status: 401,
      })
    }
    const requrl = new URL(req.url)
    const roomid = requrl.searchParams.get("roomid")
    if (!roomid) {
      return new Response(JSON.stringify({ "status": "Room ID Not Found" }), {
        headers: { "Content-Type": "application/json" },
        status: 404,
      })
    }
    const startChat = requrl.searchParams.get("startChat") === "true"
    //Start Chatがtrueの場合、roomidの部屋から最新のメッセージを100件取得
    if (startChat) {

      const room = await rooms.findOne({
        userid: roomid,
      })
      if (!room) {
        return new Response(JSON.stringify({ "status": "Room Not Found" }), {
          headers: { "Content-Type": "application/json" },
          status: 404,
        })
      }
      
    }
  },
}