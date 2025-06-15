import { createSignal, For, onMount } from "solid-js";

interface PackageInfo {
  identifier: string;
  name: string;
  version: string;
  description?: string;
  downloadUrl: string;
  sha256?: string;
}

export default function ExtensionRegistry() {
  const [packages, setPackages] = createSignal<PackageInfo[]>([]);
  const [query, setQuery] = createSignal("");

  const fetchPackages = async (q = "") => {
    const body = {
      events: [
        {
          identifier: "takos",
          eventId: "extensions:search",
          payload: q ? { q } : {},
        },
      ],
    };
    const res = await fetch("/api/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const data = await res.json();
      setPackages(data[0]?.result?.packages ?? []);
    }
  };

  const install = async (id: string) => {
    const body = {
      events: [
        { identifier: "takos", eventId: "extensions:install", payload: { id } },
      ],
    };
    await fetch("/api/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  };

  onMount(() => fetchPackages());

  return (
    <div>
      <h3 class="text-lg mb-2">Registry</h3>
      <input
        type="text"
        value={query()}
        onInput={(e) => setQuery(e.currentTarget.value)}
        onKeyDown={(e) => e.key === "Enter" && fetchPackages(query())}
        class="border px-2 py-1 mb-2 bg-transparent"
      />
      <ul class="space-y-1">
        <For each={packages()}>{(pkg) => (
          <li class="flex justify-between items-center">
            <span>{pkg.name}</span>
            <button
              class="text-sm text-blue-500 underline"
              onClick={() => install(pkg.identifier)}
            >
              Install
            </button>
          </li>
        )}</For>
      </ul>
    </div>
  );
}
