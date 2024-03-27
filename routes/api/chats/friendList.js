import { getCookies } from "https://deno.land/std@0.220.1/http/cookie.ts";
import sessionID from "../../../models/sessionid.js";
import csrfToken from "../../../models/csrftoken.js";
import rooms from "../../../models/rooms.js";
import Friends from "../../../models/friends.js";
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
    const sessionid = cookies.sessionid;
    // Check if the session ID is valid↑↑↑
    try {
      await sessionID.deleteOne({ sessionID: sessionid });
      const { userName } = result;
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
      if (error instanceof MongooseServerSelectionError) {
        return new Response(
          JSON.stringify({
            "status": "error",
            "message": "Database connection failed",
          }),
          {
            headers: { "Content-Type": "application/json" },
            status: 500,
          },
        );
      }
      // 他のエラーハンドリング
    }
  },
};
