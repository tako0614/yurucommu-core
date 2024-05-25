import redis from "redis";
import rooms from "../../../../models/rooms.ts";
import users from "../../../../models/users.ts";

const subClient = redis.createClient({
  url: "redis://192.168.0.241:6379",
});
const pubClient = redis.createClient({
  url: "redis://192.168.0.241:6379",
});
/**?
 {
            sessionid: data.sessionid,
            type: "message",
            message: data.message,
            sender: ctx.state.data.userid.toString(),
 */
subClient.on("error", (err) => console.error("Sub Client Error", err));
pubClient.on("error", (err) => console.error("Pub Client Error", err));

await subClient.connect();
await pubClient.connect();

async function subscribeMessage(channel) {
  await subClient.subscribe(channel, (message) => {
    const data = JSON.parse(message);
    //sessionsオブジェクトからroomidが一致するものをすべて取得
    const sessionsInRoom = Array.from(sessions.values()).filter(
      (session) => session.roomid === data.roomid,
    );
    //roomidが一致するセッションがない場合は終了
    if (sessionsInRoom.length === 0) {
      return;
    }
    //senderをユーザー名に変換
    console.log(data);
    const sender = sessions.get(data.sessionid);
    data.sender = sender.membersNameChash[data.sender];
    //roomidが一致するセッションがある場合は、そのセッションにメッセージを送信
    sessionsInRoom.forEach((session) => {
      session.ws.send(JSON.stringify(data));
      console.log("")
    });
  });
}

await subscribeMessage("takos");
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
      const { socket, response } = Deno.upgradeWebSocket(req)
      socket.onopen = async (socket, req) => {
      }
      socket.onmessage = async function (event) {
        const data = JSON.parse(event.data)
        if (data.type == "join") {
          const roomid = data.roomid
          const isJoiningRoom = await rooms.findOne({
            name: roomid,
            users: ctx.state.data.userid.toString(),
          })
          const userInfo = users.findOne({
            _id: ctx.state.data.userid.toString(),
          })
          if (userInfo === null || userInfo === undefined) {
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
          //console.log(isJoiningRoom)
          const sessionid = generateSessionId()
          sessions.set(sessionid, {
            ws: socket,
            roomid: roomid,
            id: ctx.state.data.userid.toString(),
            membersNameChash: {
              [ctx.state.data.userid.toString()]: userInfo.userName,
            },
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
            sender: ctx.state.data.userid.toString(),
            roomid: roomid,
          }
          const res = await rooms.updateOne(
            { name: roomid },
            {
              $push: {
                messages: {
                  sender: ctx.state.data.userid.toString(),
                  message: data.message,
                },
              },
            },
          )
          pubClient.publish("takos", JSON.stringify(result))
        }
      }
      socket.onclose = (ws) => {
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
