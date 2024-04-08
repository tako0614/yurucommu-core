import ChatAddFriend from "../components/Chats/ChatAddFriend.jsx"
import { load } from "https://deno.land/std@0.204.0/dotenv/mod.ts"
import users from "../models/users.js"
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
}
