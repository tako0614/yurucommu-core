import { load } from "https://deno.land/std@0.204.0/dotenv/mod.ts"
const env = await load()
const sitekey = env["recaptcha_site_key"]
const url = `https://www.google.com/recaptcha/api.js?render=${sitekey}`
import PleaseLogin from "../../islands/PleaseLogin.jsx"
import { getCookies } from "https://deno.land/std@0.220.1/http/cookie.ts"
import users from "../../models/users.ts"
import sessionID from "../../models/sessionid.ts"
import LogoutButton from "../../islands/LogoutButton.jsx"
export const handler = {
  GET(req, ctx) {
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
//PleaseLogin
export default function settingPage({ data }) {
  return (
    <>
      <head>
        <title>{data.loggedIn ? ("設定") : ("エラー")}</title>
        <meta
          name="description"
          content="日本産オープンソース分散型チャットアプリ「tako's」"
        />
        <script src={url}></script>
        <script src="./rechapcha.js"></script>
        <link rel="stylesheet" href="/style.css"></link>
      </head>
      {data.loggedIn ? <Setting></Setting> : <PleaseLogin />}
    </>
  )
}
import Chat from "../../components/Chats/Chat.jsx"
function Setting() {
  return (
    <>
      <Chat isSetting={true}></Chat>
    </>
  )
}
function ProfileSetting() {
  return (
    <>
      <div class="grid gap-4">
        <div class="grid gap-1.5">
          <h2 class="text-lg font-semibold">プロフィール</h2>
          <p class="text-sm text-gray-500">
            アカウントの情報を変更することができます
          </p>
        </div>
        <div class="grid gap-4">
          <div class="grid gap-1.5">
            <label for="name" class="block text-sm font-medium">
              ユーザーネーム
            </label>
            <input
              class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              id="name"
              placeholder="Enter your name"
            />
          </div>
          <div class="grid gap-1.5">
            <label for="username" class="block text-sm font-medium">
              パスワード
            </label>
            <input
              class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              id="username"
              placeholder="Enter your username"
            />
          </div>
        </div>
      </div>
    </>
  )
}
