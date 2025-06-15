import { createSignal, For } from "solid-js";
import { req } from "../api.ts";

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
    <div class="bg-white shadow rounded p-4">
      <h2 class="text-xl font-semibold mb-4">Domains</h2>
      <ul class="mb-4 space-y-1">
        <For each={domains()}>
          {(d) => (
            <li class="flex justify-between">
              <span>{d.name}</span>
              <span>{d.verified ? "✅" : "❌"}</span>
            </li>
          )}
        </For>
      </ul>
      <div class="flex items-center space-x-2 mb-2">
        <input
          class="flex-1 border border-gray-300 p-1 rounded"
          ref={domainInput!}
          placeholder="example.com"
        />
        <button
          type="button"
          class="px-3 py-1 bg-blue-500 text-white rounded"
          onClick={requestDomain}
        >
          Request
        </button>
        <button
          type="button"
          class="px-3 py-1 bg-gray-500 text-white rounded"
          onClick={refresh}
        >
          Refresh
        </button>
      </div>
      {token() && <p class="text-sm text-gray-600">{token()}</p>}
    </div>
  );
}
