import { getCookies } from "https://deno.land/std@0.220.1/http/cookie.ts";
import sessionID from "../../../models/sessionid.js";
import csrfToken from "../../../models/csrftoken.js";
import rooms from "../../../models/rooms.js";
import messages from "../../../models/messages.js";
import { checksesssionCSRF, isNullorUndefind } from "../../../util/Checker.js";
export const handler = {
  async POST(req) {
    // Check if the CSRF token and session ID are valid
    const isCsrfSessionid = await checksesssionCSRF(req);
    if (isCsrfSessionid.status === false) {
      return new Response(JSON.stringify({ "status": "error" }), {
        headers: { "Content-Type": "application/json" },
        status: 403,
      });
    }
    const { sessionidinfo } = isCsrfSessionid;
    // send message
    const { userName } = sessionidinfo;
    const { room, message } = data;

    const roomInfo = await rooms.findOne({ _id: room });
    if (
      roomInfo === null || roomInfo === undefined ||
      !Array.isArray(roomInfo.users)
    ) {
      return new Response(JSON.stringify({ "status": "error" }), {
        headers: { "Content-Type": "application/json" },
        status: 403,
      });
    }
    const roomMembers = roomInfo.users;
    if (roomMembers.includes(userName)) {
      //groupの中にユーザーがいる場合の処理
      const messageData = {
        userName: userName,
        message: message,
      };
      try {
        await messages.create(messageData);
        await rooms.updateOne({ _id: room }, {
          latestmessage: message,
          latestMessageTime: Date.now(),
        });
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
