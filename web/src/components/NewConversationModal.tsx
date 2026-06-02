import { createSignal, For, Show } from "solid-js";
import { searchActors } from "../lib/api.ts";
import { UserAvatar } from "./UserAvatar.tsx";
import { Actor } from "../types/index.ts";

interface NewConversationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (actor: Actor) => void;
}

export function NewConversationModal(props: NewConversationModalProps) {
  const [query, setQuery] = createSignal("");
  const [results, setResults] = createSignal<Actor[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const handleSearch = async (q: string) => {
    setQuery(q);
    if (q.trim().length < 2) {
      setResults([]);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const actors = await searchActors(q);
      setResults(actors);
    } catch (e) {
      console.error("Search failed:", e);
      setError("\u691C\u7D22\u306B\u5931\u6557\u3057\u307E\u3057\u305F");
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = (actor: Actor) => {
    props.onSelect(actor);
    setQuery("");
    setResults([]);
    props.onClose();
  };

  return (
    <Show when={props.isOpen}>
      <div class="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4">
        {/* Backdrop */}
        <div class="absolute inset-0 bg-black/60" onClick={props.onClose} />

        {/* Modal */}
        <div class="relative w-full max-w-md bg-neutral-900 rounded-2xl overflow-hidden shadow-xl">
          {/* Header */}
          <div class="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
            <h2 class="text-lg font-semibold">
              {"\u65B0\u3057\u3044\u30E1\u30C3\u30BB\u30FC\u30B8"}
            </h2>
            <button
              onClick={props.onClose}
              class="p-1 text-neutral-400 hover:text-white transition-colors"
            >
              <svg
                class="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* Search input */}
          <div class="p-4 border-b border-neutral-800">
            <div class="flex items-center gap-3">
              <span class="text-neutral-400">{"\u691C\u7D22:"}</span>
              <input
                type="text"
                value={query()}
                onInput={(e) => handleSearch(e.currentTarget.value)}
                placeholder={"\u30E6\u30FC\u30B6\u30FC\u3092\u691C\u7D22..."}
                class="flex-1 bg-transparent text-white placeholder-neutral-500 outline-none"
                autofocus
              />
            </div>
          </div>

          {/* Results */}
          <div class="max-h-80 overflow-y-auto">
            <Show
              when={!loading()}
              fallback={
                <div class="p-8 text-center text-neutral-500">
                  {"\u8AAD\u307F\u8FBC\u307F\u4E2D..."}
                </div>
              }
            >
              <Show
                when={!error()}
                fallback={
                  <div class="p-8 text-center text-red-400">{error()}</div>
                }
              >
                <Show
                  when={results().length > 0}
                  fallback={
                    <Show
                      when={query().length >= 2}
                      fallback={
                        <div class="p-8 text-center text-neutral-500">
                          {"\u30E6\u30FC\u30B6\u30FC\u540D\u3067\u691C\u7D22"}
                        </div>
                      }
                    >
                      <div class="p-8 text-center text-neutral-500">
                        {
                          "\u30E6\u30FC\u30B6\u30FC\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093"
                        }
                      </div>
                    </Show>
                  }
                >
                  <div class="py-2">
                    <For each={results()}>
                      {(actor) => (
                        <button
                          onClick={() => handleSelect(actor)}
                          class="w-full flex items-center gap-3 px-4 py-3 hover:bg-neutral-800 transition-colors"
                        >
                          <UserAvatar
                            avatarUrl={actor.icon_url}
                            name={actor.name || actor.preferred_username}
                            size={44}
                          />
                          <div class="flex-1 text-left">
                            <p class="font-medium">
                              {actor.name || actor.preferred_username}
                            </p>
                            <p class="text-sm text-neutral-500">
                              @{actor.preferred_username}
                            </p>
                          </div>
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
              </Show>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
}
