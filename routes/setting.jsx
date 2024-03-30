import { load } from "https://deno.land/std@0.204.0/dotenv/mod.ts";
const env = await load();
const sitekey = env["recaptcha_site_key"];
const url = `https://www.google.com/recaptcha/api.js?render=${sitekey}`;
import PleaseLogin from "../islands/PleaseLogin.jsx";
import { getCookies } from "https://deno.land/std@0.220.1/http/cookie.ts";
import users from "../models/users.js";
import sessionID from "../models/sessionid.js";
import LogoutButton from "../islands/LogoutButton.jsx";
export const handler = {
  GET(req, ctx) {
    if(ctx.state.data.loggedIn){
      return ctx.render({ loggedIn: true, userName: ctx.state.data.userName });
    } else {
      return ctx.render({ loggedIn: false });
    }
  },
};
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
        <script src="https://cdn.tailwindcss.com"></script>
      </head>
      {data.loggedIn ? <Setting></Setting> : <PleaseLogin />}
    </>
  );
}

function Setting() {
  return (
    <>
      <div class="w-full min-h-screen bg-black text-white flex flex-col gap-0.5">
        <div class="flex flex-1 min-h-0">
          <nav class="border-gray-800 border-r w-60 flex flex-col">
            <div class="p-4 flex flex-col gap-0.5">
              <a
                class="flex items-center gap-2 py-2 px-3 rounded-md bg-gray-800 text-sm font-medium"
                href="#"
              >
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  class="w-5 h-5"
                >
                  <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path>
                  <circle cx="12" cy="7" r="4"></circle>
                </svg>
                <span class="font-medium">プロフィール</span>
              </a>
              <a
                class="flex items-center gap-2 py-2 px-3 rounded-md text-sm font-medium"
                href="#"
              >
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  class="w-5 h-5"
                >
                  <rect width="18" height="11" x="3" y="11" rx="2" ry="2">
                  </rect>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                </svg>
                <span class="font-medium">プライバシー</span>
              </a>
              <a
                class="flex items-center gap-2 py-2 px-3 rounded-md text-sm font-medium"
                onclick="alert('Yo!')"
                href="#"
              >
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  class="w-5 h-5"
                >
                  <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z">
                  </path>
                  <circle cx="12" cy="12" r="3"></circle>
                </svg>
                <span class="font-medium">その他</span>
              </a>
              <LogoutButton></LogoutButton>
            </div>
          </nav>
          <main class="flex flex-col gap-4 p-4 min-h-0 flex-1">
            <ProfileSetting />
          </main>
        </div>
      </div>
    </>
  );
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
  );
}
