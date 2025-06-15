import { createSignal } from "solid-js";
import LoginForm from "./components/LoginForm";
import DomainSection from "./components/DomainSection";
import PackageSection from "./components/PackageSection";

export default function App() {
  const [authed, setAuthed] = createSignal(false);

  return (
    <div class="p-4">
      <h1 class="text-2xl font-bold mb-4">Takopack Registry 管理</h1>
      {authed()
        ? (
          <>
            <DomainSection />
            <PackageSection />
          </>
        )
        : <LoginForm onAuthed={() => setAuthed(true)} />}
    </div>
  );
}
