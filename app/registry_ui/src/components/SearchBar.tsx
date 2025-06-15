import { createSignal, Show } from "solid-js";

interface SearchBarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onSortChange: (sort: string) => void;
  packageCount: number;
  isLoading?: boolean;
}

export default function SearchBar(props: SearchBarProps) {
  const [showSortMenu, setShowSortMenu] = createSignal(false);
  const [currentSort, setCurrentSort] = createSignal("name");

  const sortOptions = [
    { value: "name", label: "名前順" },
    { value: "version", label: "バージョン順" },
    { value: "updated", label: "更新日順" },
    { value: "created", label: "作成日順" },
  ];

  const handleSortSelect = (sortValue: string) => {
    setCurrentSort(sortValue);
    props.onSortChange(sortValue);
    setShowSortMenu(false);
  };

  return (
    <div class="bg-gray-800/30 backdrop-blur-sm border-b border-gray-700/50 sticky top-0 z-10">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-4 sm:space-y-0">
          {/* 検索バー */}
          <div class="flex-1 max-w-lg">
            <div class="relative">
              <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <svg
                  class="h-5 w-5 text-gray-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
              </div>
              <input
                type="text"
                value={props.searchQuery}
                onInput={(e) => props.onSearchChange(e.currentTarget.value)}
                placeholder="パッケージを検索..."
                class="block w-full pl-10 pr-3 py-2.5 border border-gray-600 rounded-lg bg-gray-700/50 text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-colors duration-200"
              />
              <Show when={props.isLoading}>
                <div class="absolute inset-y-0 right-0 pr-3 flex items-center">
                  <div class="animate-spin h-4 w-4 border-2 border-purple-500 border-t-transparent rounded-full">
                  </div>
                </div>
              </Show>
            </div>
          </div>

          {/* ソートとフィルター */}
          <div class="flex items-center space-x-4">
            <div class="flex items-center space-x-2 text-sm text-gray-400">
              <span>{props.packageCount}個のパッケージ</span>
            </div>

            <div class="relative">
              <button
                type="button"
                onClick={() => setShowSortMenu(!showSortMenu())}
                class="flex items-center space-x-2 px-3 py-2 bg-gray-700/50 border border-gray-600 rounded-lg text-sm font-medium text-gray-300 hover:bg-gray-700 hover:text-white transition-colors duration-200"
              >
                <svg
                  class="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12"
                  />
                </svg>
                <span>
                  {sortOptions.find((opt) => opt.value === currentSort())
                    ?.label}
                </span>
                <svg
                  class={`w-4 h-4 transition-transform duration-200 ${
                    showSortMenu() ? "rotate-180" : ""
                  }`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>

              <Show when={showSortMenu()}>
                <div class="absolute right-0 mt-2 w-48 bg-gray-800 border border-gray-700 rounded-lg shadow-lg py-1 z-20">
                  {sortOptions.map((option) => (
                    <button
                      type="button"
                      onClick={() => handleSortSelect(option.value)}
                      class={`w-full text-left px-4 py-2 text-sm transition-colors duration-200 ${
                        currentSort() === option.value
                          ? "bg-purple-600 text-white"
                          : "text-gray-300 hover:bg-gray-700 hover:text-white"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </Show>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
