import { createSignal, For } from "solid-js";
import { req } from "../api";

interface Domain {
  name: string;
  verified: boolean;
}

export default function DomainSection() {
  const [domains, setDomains] = createSignal<Domain[]>([]);
  const [token, setToken] = createSignal("");
  let domainInput!: HTMLInputElement;

  const refresh = async () => {
    const data = await req<{ domains: Domain[] }>("/api/domains");
    setDomains(data.domains);
  };

  const requestDomain = async () => {
    const data = await req<{ token: string }>("/api/domains/request", "POST", {
      domain: domainInput.value,
    });
    setToken(`token: ${data.token}`);
    refresh();
  };

  return (
    <div class="mt-4">
      <h2 class="text-xl mb-2">Domains</h2>
      <ul class="mb-2">
        <For each={domains()}>
          {(d) => <li>{d.name}{d.verified ? " ✅" : " ❌"}</li>}
        </For>
      </ul>
      <input
        class="border p-1 mr-2"
        ref={domainInput!}
        placeholder="example.com"
      />
      <button
        type="button"
        class="px-2 py-1 bg-blue-500 text-white mr-2"
        onClick={requestDomain}
      >
        Request
      </button>
      <span class="mr-2">{token()}</span>
      <button
        type="button"
        class="px-2 py-1 bg-gray-500 text-white"
        onClick={refresh}
      >
        Refresh
      </button>
    </div>
  );
}
