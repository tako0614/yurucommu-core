import { Component, Show } from "solid-js";
import { useAtom } from "solid-jotai";
import { loggedInState } from "../state.ts";

const WelcomePage: Component = () => {
  const [loggedIn] = useAtom(loggedInState);
  return (
    <div style={{ padding: "1rem", "font-family": "sans-serif" }}>
      <h1>takos hostへようこそ</h1>
      <Show when={loggedIn()} fallback={<a href="/auth">ログイン</a>}>
        <a href="/admin">管理画面へ</a>
      </Show>
    </div>
  );
};

export default WelcomePage;
