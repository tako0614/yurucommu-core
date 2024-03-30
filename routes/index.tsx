import Welcom from "../islands/Welcome.tsx";
import { getCookies } from "https://deno.land/std@0.220.1/http/cookie.ts";
import users from "../models/users.js";
import sessionID from "../models/sessionid.js";
import { load } from "https://deno.land/std@0.204.0/dotenv/mod.ts";
import Chat from "../components/Chats/Chat.jsx";
const env = await load();
const sitekey = env["recaptcha_site_key"];
const url = `https://www.google.com/recaptcha/api.js?render=${sitekey}`;

export const handler = {
  GET(req: any, ctx: any) {
    if (ctx.state.data.loggedIn) {
      return ctx.render({ loggedIn: true, userName: ctx.state.data.userName });
    } else {
      return ctx.render({ loggedIn: false });
    }
  },
};
export default function Home({ data }: { data: any }) {
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
        ? <Chat isChoiceUser={false} />
        : <Welcom sitekey={sitekey} />}
    </>
  );
}
