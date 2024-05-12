import ChatAddFriend from "../components/Chats/ChatAddFriend.jsx"
import { load } from "$std/dotenv/mod.ts"
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
}
