import csrftoken from "../../../models/csrftoken.js";
import { getCookies } from "https://deno.land/std@0.220.1/http/cookie.ts";
import users from "../../../models/users.js";
import friends from "../../../models/friends.js";
export const handler = {
  async GET(req, ctx) {
    if (!ctx.state.data.loggedIn) {
      return new Response(JSON.stringify({ "status": "Please Login" }), {
        headers: { "Content-Type": "application/json" },
        status: 401,
      });
    }
    const cookies = getCookies(req.headers);
    const url = new URL(req.url);
    const csrfToken = url.searchParams.get("csrfToken") || "";
    if (typeof csrfToken !== "string") {
      console.log("aa");
      return { status: false };
    }
    const iscsrfToken = await csrftoken.findOne({ token: csrfToken });
    if (iscsrfToken === null || iscsrfToken === undefined) {
      return new Response(JSON.stringify({ "status": "Please Login" }), {
        headers: { "Content-Type": "application/json" },
        status: 401,
      });
    }
    if (iscsrfToken.sessionID !== cookies.sessionid) {
      return { status: false };
    }
    await csrftoken.deleteOne({ token: csrfToken });
    const requirments = url.searchParams.get("requirments") || "";
    switch (requirments) {
      case "getFriendIcon": {
        const friendName = url.searchParams.get("friendName") || "";
        const userName = ctx.state.data.userName;
        const result = await getFriendIcon(friendName, userName);
        if (!result.status) {
          return new Response(JSON.stringify({ status: false }), {
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(
          JSON.stringify({ icon: result.friendIcon, status: true }),
          {
            headers: { "Content-Type": "application/json" },
          },
        );
      }
      case "getMyIcon":
        break;
      case "addFriendIcon": {
        const friendKey = url.searchParams.get("friendKey") || "";
        const result = await addFriendIcon(friendKey);
        if (!result.status) {
          return { status: false };
        }
        return new Response(result.friendIcon, {
          headers: { "Content-Type": "image/webp" },
        });
      }
      default:
        console.log("aa");
        break;
    }
  },
};
async function addFriendIcon(friendKey) {
  const friendInfo = await users.findOne({ addFriendKey: friendKey }, {
    userName: 1,
  });
  if (friendInfo === null || friendInfo === undefined) {
    return { status: false };
  }
  const friendName = friendInfo.userName;
  try {
    const friendIcon = await Deno.readFile(`./files/icons/${friendName}.webp`);
    return { status: true, friendIcon };
  } catch {
    const friendIcon = await Deno.readFile(`./strict/people.png`);
    return { status: true, friendIcon };
  }
}
async function getFriendIcon(friendName, userName) {
  const friendInfo = await friends.findOne({ userName: friendName }, {
    friends: 1,
  });
  if (friendInfo === null || friendInfo === undefined) {
    return { status: false };
  }
  const friend = friendInfo.friends.find((friend) =>
    friend.userName === userName
  );
  if (friend === null || friend === undefined) {
    return { status: false };
  }
  try {
    const friendIcon = await Deno.readFile(`./files/icons/${friendName}.webp`);
    return { status: true, friendIcon };
  } catch {
    const friendIcon = await Deno.readFile(`./strict/people.png`);
    return { status: true, friendIcon };
  }
}
