import { Handlers, PageProps } from "$fresh/server.ts"
import { getCookies } from "https://deno.land/std@0.220.1/http/cookie.ts"
import users from "../models/users.ts"
import sessionID from "../models/sessionid.ts"
import Chat from "../components/Chats/Chat.jsx"
import PleaseLogin from "../islands/PleaseLogin.jsx"
export const handler = {
  GET(req: any, ctx: any) {
    if (ctx.state.data.loggedIn) {
      return ctx.render({
        loggedIn: true,
        userName: ctx.state.data.userName,
      })
    } else {
      return ctx.render({ loggedIn: false })
    }
  },
}
export default function talk(props: PageProps) {
  const roomid = props.params.userName
  const userName = props.data.userName
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
      {props.data.loggedIn
        ? <Chat userName={userName} isChoiceUser={true} />
        : <PleaseLogin />}
    </>
  )
}
