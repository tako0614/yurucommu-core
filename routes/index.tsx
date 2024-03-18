
import Welcom from "../islands/Welcome.tsx";
import { getCookies } from "https://deno.land/std@0.220.1/http/cookie.ts";
import users from "../models/users.js";
import sessionID from "../models/sessionid.js";
import { load } from "https://deno.land/std@0.204.0/dotenv/mod.ts";
import Talks from "../components/Talk.jsx"
const env = await load();
const sitekey = env["recaptcha_site_key"];
const url = `https://www.google.com/recaptcha/api.js?render=${sitekey}`

export const handler = {
  async GET(req: any, ctx: any) {
    const cookies = getCookies(req.headers);
    const sessionid = cookies.sessionid;
    if(sessionid === undefined) {
      return ctx.render({ loggedIn: false});
    }
    const sessions = await sessionID.findOne({sessionID: sessionid});
    if(sessions === null) {
      return ctx.render({ loggedIn: false});
    }
    const today = new Date()
    const sessionCreatedat = sessions.createdAt
    const sessionExpiryDate = new Date(sessionCreatedat.getTime())
    sessionExpiryDate.setMonth(sessionExpiryDate.getMonth() + 3)
    if(today < sessionExpiryDate) {
      // セッションIDが作成されてから3ヶ月未満の場合に行う処理
      const result = await sessionID.updateOne({sessionID: sessionid},{$set: {lastLogin: today}})
      if(result === null) {
        return ctx.render({ loggedIn: false,});
      }
    }
    const userName = sessions.userName;
    const user = await users.findOne({userName: userName})
    if(user === null) {
      return ctx.render({ loggedIn: false});
    }
    const mail = user.mail;
    return ctx.render({ userName, mail, loggedIn: true});
  },
};
export default function Home({ data }: { data: any}) {
  return (
    <>
      <head>
        <title>tako's | takos.jp</title>
        <meta name="description" content="日本産オープンソース分散型チャットアプリ「tako's」" />
        <script src={url}></script>
        <script src="./rechapcha.js"></script>
        <link rel="stylesheet" href="/style.css"></link>
      </head>
      {data.loggedIn ? (
        <Talks></Talks>
      ) : (
        <Welcom sitekey={sitekey} />
      )}
    </>
  );
}
