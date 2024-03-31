import Welcom from "../islands/Welcome.tsx";
import { getCookies } from "https://deno.land/std@0.220.1/http/cookie.ts";
import users from "../models/users.js";
import sessionID from "../models/sessionid.js";
import { load } from "https://deno.land/std@0.204.0/dotenv/mod.ts";
import Chat from "../components/Chats/Chat.jsx";
import { useState } from "preact/hooks";
const env = await load();
const sitekey = env["recaptcha_site_key"];
const url = `https://www.google.com/recaptcha/api.js?render=${sitekey}`;
/*
export const handler = {
  GET(req: any, ctx: any) {
    if (ctx.state.data.loggedIn) {
      return ctx.render({ loggedIn: true, userName: ctx.state.data.userName });
    } else {
      return ctx.render({ loggedIn: false });
    }
  },
};*/
export const handler = {
  async GET(req: any, ctx: any) {
    if (!ctx.state.data.loggedIn) {
      return ctx.render({ loggedIn: false });
    }
    const requrl = new URL(req.url);
    const key = requrl.searchParams.get("key") || "";
    if (key === "" || key === null || key === undefined) {
      return ctx.render({ loggedIn: true, isAddFriendForm: false });
    }
    const userInfo = await users.findOne({ addFriendKey: key }, {
      isAddFriendForm: false,
    });
    if (userInfo === null || userInfo === undefined) {
      return ctx.render({ loggedIn: true, isAddFriendForm: false });
    }
    if (userInfo.userName === ctx.state.data.userName) {
      return ctx.render({
        loggedIn: true,
        key,
        isAddFriendForm: true,
        userName: ctx.state.data.userName,
      });
    }
  },
};
export default function Home({ data }: { data: any }) {
  useState(() => {
    const script = document.createElement("script");
    script.src = url;
    script.async = true;
    document.body.appendChild(script);
  }
  );
  return (
    <>
      <head>
        <title>tako's | takos.jp</title>
        <meta
          name="description"
          content="日本産オープンソース分散型チャットアプリ「tako's」"
        />
        <link rel="stylesheet" href="/style.css"></link>
      </head>
      {data.loggedIn
        ? (
          <Chat
            isChoiceUser={false}
            isAddFriendForm={data.isAddFriendForm}
            addFriendKey={data.key}
          />
        )
        : <Welcom sitekey={sitekey} />}
    </>
  );
}