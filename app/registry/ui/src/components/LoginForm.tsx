import { createSignal } from "solid-js";
import { req } from "../api";

export default function LoginForm(props: { onAuthed: () => void }) {
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");

  const login = async () => {
    await req("/api/login", "POST", { email: email(), password: password() });
    props.onAuthed();
  };

  const register = async () => {
    await req("/api/register", "POST", {
      email: email(),
      password: password(),
    });
    alert("Check email for verification");
  };

  return (
    <div>
      <h2 class="text-xl mb-2">ログイン/登録</h2>
      <input
        class="border p-1 mr-2"
        placeholder="email"
        value={email()}
        onInput={(e) => setEmail(e.currentTarget.value)}
      />
      <input
        class="border p-1 mr-2"
        type="password"
        placeholder="password"
        value={password()}
        onInput={(e) => setPassword(e.currentTarget.value)}
      />
      <button class="px-2 py-1 bg-blue-500 text-white mr-2" onClick={login}>
        Login
      </button>
      <button class="px-2 py-1 bg-gray-500 text-white" onClick={register}>
        Register
      </button>
    </div>
  );
}
