import ChatAddFriend from "../components/Chats/ChatAddFriend.jsx"
/*import { load } from "$std/dotenv/mod.ts"
import users from "../models/users.ts"
import Chat from "../components/Chats/Chat.jsx"
const env = await load()
const origin = env["friendOrigin"]
export default function Home(props) {
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
      <ChatAddFriend origin={origin}></ChatAddFriend>
    </>
  )
}*/
import Welcom from "../islands/Welcome.tsx"
import users from "../models/users.ts"
import { load } from "$std/dotenv/mod.ts"
import Chat from "../components/Chats/Chat.jsx"
const env = await load()
const sitekey = env["recaptcha_site_key"]
const url = `https://www.google.com/recaptcha/api.js?render=${sitekey}`
const origin = env["friendOrigin"]
export const handler = {
  async GET(req: any, ctx: any) {
    if (!ctx.state.data.loggedIn) {
      return ctx.render({ loggedIn: false, isAddFriendForm: false })
    }
    return ctx.render({
      loggedIn: true,
      isAddFriendForm: false,
      userName: ctx.state.data.userName,
    })
  },
}
export default function Home({ data }: { data: any }) {
  return (
    <>
      {data.loggedIn
        ? (
          <>
            <head>
              <title>tako's | takos.jp</title>
              <meta
                name="description"
                content="日本産オープンソース分散型チャットアプリ「tako's」"
              />
              <link rel="stylesheet" href="/style.css"></link>
            </head>
            <ChatAddFriend origin={origin}></ChatAddFriend>
          </>
        )
        : (
          <>
            <head>
              <title>tako's | takos.jp</title>
              <meta
                name="description"
                content="日本産オープンソース分散型チャットアプリ「tako's」"
              />
              <link rel="stylesheet" href="/style.css"></link>
            </head>
            <Welcom sitekey={sitekey} />
          </>
        )}
    </>
  )
}
