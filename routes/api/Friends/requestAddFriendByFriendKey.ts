import users from "../../../models/users.js";
import requestAddFriend from "../../../models/reqestAddFriend.js";
import csrftoken from "../../../models/csrftoken.js";
import { getCookies } from "https://deno.land/std@0.220.1/http/cookie.ts";
import re from "https://esm.sh/v135/preact-render-to-string@6.3.1/X-ZS8q/denonext/preact-render-to-string.mjs";
export const handler = {
  // deno-lint-ignore no-explicit-any
  async POST(req: Request, ctx: any) {
    try {
      if (!ctx.state.data.loggedIn) {
        return new Response(JSON.stringify({ "status": "Please Login" }), {
          headers: { "Content-Type": "application/json" },
          status: 401,
        });
      }
      const cookies = getCookies(req.headers);
      const data = await req.json();
      if (typeof data.csrftoken !== "string") {
        return { status: false };
      }
      const iscsrfToken = await csrftoken.findOne({ token: data.csrftoken });
      if (iscsrfToken === null || iscsrfToken === undefined) {
        return { status: false };
      }
      if (iscsrfToken.sessionID !== cookies.sessionid) {
        return { status: false };
      }
      await csrftoken.deleteOne({ token: data.csrftoken });
      const userName = ctx.state.data.userName;
      const friendKey = data.friendKey;
      //friendKeyが正しいかどうか
      const isRightFriendKey = await users.findOne({ friendKey: friendKey }, {
        userName: 1,
      });
      if (isRightFriendKey === null || isRightFriendKey === undefined) {
        return new Response(JSON.stringify({ status: "error" }), {
          headers: { "Content-Type": "application/json" },
          status: 403,
        });
      }
      const friendName = isRightFriendKey.userName;
      //すでに友達かどうか
      const isAlreadyFriend = await users.findOne({ userName }, { friends: 1 });
      if (isAlreadyFriend !== null || isAlreadyFriend !== undefined) {
        return new Response(JSON.stringify({ status: "error" }), {
          headers: { "Content-Type": "application/json" },
          status: 403,
        });
      }
      //すでにリクエストを送っているかどうか
      const isAlreadyFriendRequest = await requestAddFriend.findOne({
        userName: friendName,
      });
      if (
        isAlreadyFriendRequest === null || isAlreadyFriendRequest === undefined
      ) {
        return new Response(JSON.stringify({ status: "error" }), {
          headers: { "Content-Type": "application/json" },
          status: 403,
        });
      }
      const isAlreadyRequest = isAlreadyFriendRequest.Applicant.find(
        (applicant: any) => {
          applicant.userName === userName;
        },
      );
      if (isAlreadyFriend) {
        return new Response(JSON.stringify({ status: "error" }), {
          headers: { "Content-Type": "application/json" },
          status: 403,
        });
      }
      //リクエストを送る
      await requestAddFriend.updateOne({ userName: friendName }, {
        $push: { Applicant: { userName } },
      });
      return new Response(JSON.stringify({ status: "success" }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    } catch (error) {
      console.log(error);
      return new Response(JSON.stringify({ status: "error" }), {
        headers: { "Content-Type": "application/json" },
        status: 500,
      });
    }
  },
};
