import Welcom from "../islands/Welcome.tsx"
import { getCookies } from "$std/http/cookie.ts"
import users from "../models/users.ts"
import sessionID from "../models/sessionid.ts"
import { load } from "$std/dotenv/mod.ts"
import Chat from "../components/Chats/Chat.jsx"
import { useState } from "preact/hooks"
const env = await load()
const sitekey = env["recaptcha_site_key"]
const url = `https://www.google.com/recaptcha/api.js?render=${sitekey}`
export const handler = {
  async GET(req: any, ctx: any) {
    if (!ctx.state.data.loggedIn) {
      return ctx.render({ loggedIn: false, isAddFriendForm: false })
    }
    const requrl = new URL(req.url)
    const key = requrl.searchParams.get("key") || ""
    if (key === "" || key === null || key === undefined) {
      return ctx.render({ loggedIn: true, isAddFriendForm: false })
    }
    const userInfo = await users.findOne({ addFriendKey: key })
    if (userInfo === null || userInfo === undefined) {
      return ctx.render({ loggedIn: true, isAddFriendForm: false })
    }
    console.log(ctx.state.data)
    console.log(userInfo._id + "   " + ctx.state.data.userid)
    if (userInfo._id !== ctx.state.data.userid) {
      return ctx.render({
        loggedIn: true,
        key,
        isAddFriendForm: true,
        userName: ctx.state.data.userName,
      })
    }
    return ctx.render({
      loggedIn: true,
      key,
      isAddFriendForm: false,
      userName: ctx.state.data.userName,
    })
  },
}
export default function Home({ data }: { data: any }) {
  console.log(data)
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
            <Chat
              isChoiceUser={false}
              isAddFriendForm={data.isAddFriendForm}
              addFriendKey={data.key}
            />
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
