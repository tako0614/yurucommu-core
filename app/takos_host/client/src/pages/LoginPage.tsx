import { Component } from "solid-js";

interface LoginPageProps {
  userName: () => string;
  setUserName: (v: string) => void;
  password: () => string;
  setPassword: (v: string) => void;
  login: (e: SubmitEvent) => Promise<void>;
}

const LoginPage: Component<LoginPageProps> = (props) => {
  return (
    <div style={{ padding: "1rem", "font-family": "sans-serif" }}>
      <h2>ログイン</h2>
      <form onSubmit={props.login}>
        <div>
          <input
            placeholder="ユーザー名"
            value={props.userName()}
            onInput={(e) => props.setUserName(e.currentTarget.value)}
          />
        </div>
        <div>
          <input
            type="password"
            placeholder="パスワード"
            value={props.password()}
            onInput={(e) => props.setPassword(e.currentTarget.value)}
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
