import { Component, Show } from "solid-js";

interface WelcomePageProps {
  loggedIn: () => boolean;
}

const WelcomePage: Component<WelcomePageProps> = (props) => {
  return (
    <div style={{ padding: "1rem", "font-family": "sans-serif" }}>
      <h1>takos hostへようこそ</h1>
      <Show when={props.loggedIn()} fallback={<a href="/auth">ログイン</a>}>
        <a href="/admin">管理画面へ</a>
      </Show>
    </div>
  );
};

export default WelcomePage;
