import { createSignal } from "solid-js";
import LoginForm from "./components/LoginForm";
import DomainSection from "./components/DomainSection";
import PackageSection from "./components/PackageSection";

export default function App() {
  const [authed, setAuthed] = createSignal(false);

  return (
    <div class="p-6">
      <h1 class="text-3xl font-bold text-center mb-6">
        Takopack Registry 管理
      </h1>
      <div class="max-w-3xl mx-auto space-y-6">
        {authed()
          ? (
            <>
              <DomainSection />
              <PackageSection />
            </>
          )
          : <LoginForm onAuthed={() => setAuthed(true)} />}
      </div>
    </div>
  );
}
