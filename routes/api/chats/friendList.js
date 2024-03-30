import { getCookies } from "https://deno.land/std@0.220.1/http/cookie.ts";
import sessionID from "../../../models/sessionid.js";
import csrfToken from "../../../models/csrftoken.js";
import rooms from "../../../models/rooms.js";
import Friends from "../../../models/friends.js";
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
    try {
      const { userName } = sessionidinfo;
      const chatRooms = await rooms.find({ users: userName });
      const friendsInfo = await Friends.findOne({ userName: userName });
      if (friendsInfo === null || friendsInfo === undefined) {
        return new Response(JSON.stringify({ "status": "You are alone" }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (
        chatRooms === null || chatRooms === undefined
      ) {
        return new Response(JSON.stringify({ "status": "You are alone" }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      const result = chatRooms.map((room) => {
        if (room.types === "friend") {
          const foundFriend = friendsInfo.friends.find((friend) => {
            friend.room === room._id;
          });
          const friendName = foundFriend.userName;
          const result = {
            roomName: friendName,
            lastMessage: room.latestmessage,
            roomID: room._id,
            latestMessageTime: room.latestMessageTime,
          };
          return result;
        } else if (room.types === "group") {
          const result = {
            roomName: room.name,
            lastMessage: room.latestmessage,
            roomID: room._id,
          };
          return result;
        } else {
          return;
        }
      });
      return new Response(
        JSON.stringify({ "status": "success", "chatRooms": result }),
        {
          headers: { "Content-Type": "application/json" },
        },
      );
    } catch (error) {
      console.log(error);
      return new Response(JSON.stringify({ "status": "error" }), {
        headers: { "Content-Type": "application/json" },
        status: 500,
      });
    }
  },
};
