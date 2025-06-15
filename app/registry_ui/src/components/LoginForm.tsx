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
    <div class="bg-white shadow rounded p-4 max-w-sm mx-auto">
      <h2 class="text-xl font-semibold mb-4 text-center">ログイン / 登録</h2>
      <div class="space-y-2">
        <input
          class="border border-gray-300 p-2 w-full rounded"
          placeholder="email"
          value={email()}
          onInput={(e) => setEmail(e.currentTarget.value)}
        />
        <input
          class="border border-gray-300 p-2 w-full rounded"
          type="password"
          placeholder="password"
          value={password()}
          onInput={(e) => setPassword(e.currentTarget.value)}
        />
      </div>
      <div class="mt-4 flex justify-end space-x-2">
        <button
          type="button"
          class="px-3 py-1 bg-blue-600 text-white rounded"
          onClick={login}
        >
          Login
        </button>
        <button
          type="button"
          class="px-3 py-1 bg-gray-600 text-white rounded"
          onClick={register}
        >
          Register
        </button>
      </div>
    </div>
  );
}
