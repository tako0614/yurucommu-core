import { getCookies } from "https://deno.land/std@0.220.1/http/cookie.ts";
import sessionID from "../../../models/sessionid.js";
import csrfToken from "../../../models/csrftoken.js";
import Friends from "../../../models/friends.js";
import requestAddFriend from "../../../models/reqestAddFriend.js";
import { checksesssionCSRF } from "../../../util/Checker.js";
export const handler = {
  async post(req, _res) {
    const isCsrfSessionid = await checksesssionCSRF(req);
    if (isCsrfSessionid.status === false) {
      return new Response(JSON.stringify({ status: "error" }), {
        headers: { "Content-Type": "application/json" },
        status: 403,
      });
    }
    const { sessionidinfo } = isCsrfSessionid;
    // request add friend
    const { userName } = sessionidinfo;
    const { friendName } = sessionidinfo.data;
    //すでに友達かどうか
    const isAlreadyFriend = await Friends.findOne({ userName: userName });
    if (isAlreadyFriend === null || isAlreadyFriend === undefined) {
      return new Response(JSON.stringify({ status: "error" }), {
        headers: { "Content-Type": "application/json" },
        status: 403,
      });
    }
    if (isAlreadyFriend.friends.includes(friendName)) {
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
      (applicant) => {
        applicant.userName === userName;
      },
    );
    if (isAlreadyRequest !== null || isAlreadyRequest !== undefined) {
      return new Response(JSON.stringify({ status: "error" }), {
        headers: { "Content-Type": "application/json" },
        status: 403,
      });
    }
    //リクエストを送る
    try {
      await requestAddFriend.updateOne(
        { userName: friendName },
        { $push: { Applicant: { userName: userName } } },
      );
    } catch (error) {
      console.log(error);
      return new Response(JSON.stringify({ status: "error" }), {
        headers: { "Content-Type": "application/json" },
        status: 403,
      });
    }
    return new Response(JSON.stringify({ status: "success" }), {
      headers: { "Content-Type": "application/json" },
    });
  },
};
