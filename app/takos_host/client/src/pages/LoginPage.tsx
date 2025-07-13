import { Component } from "solid-js";
import { useAtom } from "solid-jotai";
import { login as apiLogin } from "../api.ts";
import { loggedInState, passwordState, userNameState } from "../state.ts";

const LoginPage: Component = () => {
  const [userName, setUserName] = useAtom(userNameState);
  const [password, setPassword] = useAtom(passwordState);
  const [, setLoggedIn] = useAtom(loggedInState);

  const login = async (e: SubmitEvent) => {
    e.preventDefault();
    if (await apiLogin(userName(), password())) {
      setLoggedIn(true);
      globalThis.location.href = "/admin";
    } else {
      alert("login failed");
    }
  };
  return (
    <div style={{ padding: "1rem", "font-family": "sans-serif" }}>
      <h2>ログイン</h2>
      <form onSubmit={login}>
        <div>
          <input
            placeholder="ユーザー名"
            value={userName()}
            onInput={(e) => setUserName(e.currentTarget.value)}
          />
        </div>
        <div>
          <input
            type="password"
            placeholder="パスワード"
            value={password()}
            onInput={(e) => setPassword(e.currentTarget.value)}
          />
        </div>
        <button type="submit">ログイン</button>
      </form>
      <div>
        <a href="/">戻る</a>
      </div>
    </div>
  );
};

export default LoginPage;
