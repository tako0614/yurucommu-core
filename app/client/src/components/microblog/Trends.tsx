import { createResource, For } from "solid-js";
import { fetchTrends } from "./api.ts";

export function Trends() {
  const [trends] = createResource(fetchTrends);
  return (
    <div class="p-4 border-b border-gray-800">
      <h2 class="text-lg font-bold mb-2">トレンド</h2>
      <ul class="space-y-1">
        <For each={trends() || []}>
          {(t) => (
            <li>
              <a
                href={`/search?q=${encodeURIComponent(t.tag)}`}
                class="text-blue-400 hover:underline"
              >
                {t.tag}
              </a>
              <span class="text-gray-400 ml-2 text-sm">{t.count}</span>
            </li>
          )}
        </For>
      </ul>
    </div>
  );
}
