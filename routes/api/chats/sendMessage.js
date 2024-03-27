import { getCookies } from "https://deno.land/std@0.220.1/http/cookie.ts";
import sessionID from "../../../models/sessionid.js";
import csrfToken from "../../../models/csrftoken.js";
import Friends from "../../../models/friends.js";
import rooms from "../../../models/rooms.js";
import messages from "../../../models/messages.js";
export const handler = {
  async POST(req) {
    const data = await req.json();
    const cookies = getCookies(req.headers);
    if (cookies.sessionid === undefined) {
      return new Response(JSON.stringify({ "status": "error" }), {
        headers: { "Content-Type": "application/json" },
        status: 403,
      });
    }
    // Check if the CSRF token is valid
    const iscsrfToken = await csrfToken.findOne({ token: data.csrftoken });
    if (iscsrfToken === null || iscsrfToken === undefined) {
      return new Response(JSON.stringify({ "status": "error" }), {
        headers: { "Content-Type": "application/json" },
        status: 403,
      });
    }
    if (iscsrfToken.sessionID !== cookies.sessionid) {
      return new Response(JSON.stringify({ "status": "error" }), {
        headers: { "Content-Type": "application/json" },
        status: 403,
      });
    }
    await csrfToken.deleteOne({ token: data.csrftoken });
    // Check if the session ID is valid
    const sessionidinfo = await sessionID.findOne({
      sessionID: cookies.sessionid,
    });
    if (sessionidinfo === null || sessionidinfo === undefined) {
      return new Response(JSON.stringify({ "status": "error" }), {
        headers: { "Content-Type": "application/json" },
        status: 403,
      });
    }
    // send message
    const { userName } = sessionidinfo;
    const { room, message } = data;

    const roomInfo = await rooms.findOne({ _id: room });
    if (roomInfo === null || roomInfo === undefined) {
      return new Response(JSON.stringify({ "status": "error" }), {
        headers: { "Content-Type": "application/json" },
        status: 403,
      });
    }
    const roomMembers = room.users;
    if (roomMembers.includes(userName)) {
      //groupの中にユーザーがいる場合の処理
      const messageData = {
        userName: userName,
        message: message,
      };
      try {
        await messages.create(messageData);
        await rooms.updateOne(
          {
            _id: room,
          },
          {
            latestmessage: message,
            latestMessageTime: Date.now(),
          },
        );
      } catch (error) {
        console.log(error);
        return new Response(JSON.stringify({ "status": "error" }), {
          headers: { "Content-Type": "application/json" },
          status: 403,
        });
      }
    } else {
      return new Response(JSON.stringify({ "status": "error" }), {
        headers: { "Content-Type": "application/json" },
        status: 403,
      });
    }
  },
};
