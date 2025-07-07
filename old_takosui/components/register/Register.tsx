import { TakosFetch } from "../../utils/TakosFetch";
import {
  PopUpFrame,
  PopUpInput,
  PopUpLabel,
  PopUpTitle,
} from "../utils/popUpFrame";
import { Accessor, createSignal } from "solid-js";
export function Register() {
  const [open, setOpen] = createSignal(false);
  const [page, setPage] = createSignal(0);
  const [email, setEmail] = createSignal("");
  const [sessionid, setSessionid] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [checkCode, setCheckCode] = createSignal("");
  const [userName, setUserName] = createSignal("");
  return (
    <>
      <button
        class="bg-[#00acee] text-white rounded-3xl py-2 px-4 hover:bg-[#00a0e9] w-full"
        onClick={() => {
          setOpen(true);
        }}
      >
        このサーバーに登録する
      </button>
      {open() && (
        <PopUpFrame
          closeScript={setOpen}
        >
          <PopUpTitle>登録</PopUpTitle>
          {page() === 0 && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setSessionid("");
                setPassword("");
                setCheckCode("");
                setUserName("");
                const response = await TakosFetch(
                  "/api/v2/sessions/register/temp",
                  {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                      email: email(),
                    }),
                  },
                );
                if (response.status !== 200) {
                  alert("エラーが発生しました");
                  return;
                }
                const data = await response.json();
                setSessionid(data.token);
                setPage(1);
              }}
            >
              <PopUpLabel htmlFor="text">email</PopUpLabel>
              <PopUpInput
                type="email"
                placeholder="tako@takos.jp"
                state={setEmail}
              />
              <div class="flex justify-end">
                <button
                  type="submit"
                  class="rounded-lg mt-3 text-white bg-[#007AFF] ring-1 ring-[rgba(0,122,255,12%)] shadow-[0_1px_2.5px_rgba(0,122,255,24%)] px-5 py-2 hover:bg-[#1f7adb] focus:outline-none disabled:bg-gray-300 disabled:dark:bg-gray-700"
                >
                  {"登録"}
                </button>
              </div>
            </form>
          )}
          {page() === 1 && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const code = checkCode();
                const response = await TakosFetch(
                  "/api/v2/sessions/register/check",
                  {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                      token: sessionid(),
                      checkCode: code,
                    }),
                  },
                );
                if (response.status !== 200) {
                  alert("エラーが発生しました");
                  return;
                }
                setPage(2);
              }}
            >
              <PopUpLabel htmlFor="text">
                メールに送信されたコードを入力してください
              </PopUpLabel>
              <PopUpInput
                type="numuer"
                placeholder="123456"
                state={setCheckCode}
              />
              <div class="flex justify-end">
                <button
                  type="submit"
                  class="rounded-lg mt-3 text-white bg-[#007AFF] ring-1 ring-[rgba(0,122,255,12%)] shadow-[0_1px_2.5px_rgba(0,122,255,24%)] px-5 py-2 hover:bg-[#1f7adb] focus:outline-none disabled:bg-gray-300 disabled:dark:bg-gray-700"
                >
                  {"検証"}
                </button>
              </div>
            </form>
          )}
          {page() === 2 && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const response = await TakosFetch(
                  "/api/v2/sessions/register",
                  {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                      userName: userName(),
                      password: password(),
                      token: sessionid(),
                    }),
                  },
                );
                if (response.status !== 200) {
                  alert("エラーが発生しました");
                  return;
                }
                const data = await response.json();

                setPage(0);
                setOpen(false);
                alert("登録が完了しました");
              }}
            >
              <PopUpLabel htmlFor="text">userName</PopUpLabel>
              <PopUpInput
                type="text"
                placeholder="tako"
                state={setUserName}
              />
              <PopUpLabel htmlFor="text">password</PopUpLabel>
              <PopUpInput
                type="password"
                placeholder="password"
                state={setPassword}
              />
              <div class="flex justify-end">
                <button
                  type="submit"
                  class="rounded-lg mt-3 text-white bg-[#007AFF] ring-1 ring-[rgba(0,122,255,12%)] shadow-[0_1px_2.5px_rgba(0,122,255,24%)] px-5 py-2 hover:bg-[#1f7adb] focus:outline-none disabled:bg-gray-300 disabled:dark:bg-gray-700"
                >
                  {"登録"}
                </button>
              </div>
            </form>
          )}
        </PopUpFrame>
      )}
    </>
  );
}
