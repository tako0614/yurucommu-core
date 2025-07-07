import { createSignal } from "solid-js";
import { PopUpFrame } from "../../utils/popUpFrame";
import { selectedRoomState } from "../../../utils/room/roomState";
import { useAtom } from "solid-jotai";
import { uuidv7 } from "uuidv7";
import { showCreateChannelModalState } from "../Content";
import { TakosFetch } from "../../../utils/TakosFetch";

export function CreateChannelModal() {
  const [showCreateChannelModal, setShowCreateChannelModal] = useAtom(
    showCreateChannelModalState,
  );
  const [selectedMode, setSelectedMode] = createSignal<"category" | "channel">(
    "category",
  );

  const [nameValue, setNameValue] = createSignal("");
  const [sellectedRoom] = useAtom(selectedRoomState);
  const createEntity = async () => {
    if (selectedMode() === "category") {
      const match = sellectedRoom()?.roomid.match(/^g\{([^}]+)\}@(.+)$/);
      if (!match) {
        return console.error("Invalid roomid");
      }
      const res = await TakosFetch("/api/v2/group/category/add", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          groupId: match[1] + "@" + match[2],
          name: nameValue(),
          id: uuidv7(),
          permissions: [],
        }),
      });
      if (!res.ok) {
        console.error("Failed to create channel");
        return alert("チャンネルの作成に失敗しました");
      }
      alert("チャンネルを作成しました");
      setNameValue("");
      setShowCreateChannelModal(false);
    }
    if (selectedMode() === "channel") {
      const match = sellectedRoom()?.roomid.match(/^g\{([^}]+)\}@(.+)$/);
      if (!match) {
        return console.error("Invalid roomid");
      }
      const res = await TakosFetch("/api/v2/group/channel/add", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          groupId: match[1] + "@" + match[2],
          name: nameValue(),
          id: uuidv7(),
          categoryId: "",
          permissions: [],
        }),
      });
      if (!res.ok) {
        console.error("Failed to create channel");
        return alert("チャンネルの作成に失敗しました");
      }
      alert("チャンネルを作成しました");
      setNameValue("");
      setShowCreateChannelModal(false);
    }
  };

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    createEntity();
  };

  return (
    <>
      {showCreateChannelModal() && (
        <PopUpFrame closeScript={setShowCreateChannelModal}>
          <div class="p-5 w-full max-w-md">
            <div class="flex justify-between items-center mb-6">
              <h2 class="text-xl font-bold">チャンネルの作成</h2>
              <button
                onClick={() =>
                  setShowCreateChannelModal(false)}
                class="text-gray-400 hover:text-white transition-colors duration-200 focus:outline-none"
                aria-label="閉じる"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>

            <div class="bg-gray-700 rounded-lg p-1 flex mb-6">
              <button
                type="button"
                onClick={() => {
                  setSelectedMode("category");
                  setNameValue("");
                }}
                class={`flex-1 py-2 px-4 rounded-md transition-all duration-200 font-medium ${
                  selectedMode() === "category"
                    ? "bg-green-500 text-white shadow-md"
                    : "bg-transparent text-gray-300 hover:bg-gray-600"
                }`}
              >
                カテゴリー
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedMode("channel");
                  setNameValue("");
                }}
                class={`flex-1 py-2 px-4 rounded-md ml-2 transition-all duration-200 font-medium ${
                  selectedMode() === "channel"
                    ? "bg-blue-500 text-white shadow-md"
                    : "bg-transparent text-gray-300 hover:bg-gray-600"
                }`}
              >
                チャンネル
              </button>
            </div>

            <form onSubmit={handleSubmit} class="space-y-4">
              <div>
                <label class="block text-sm font-medium mb-1">
                  {selectedMode() === "category"
                    ? "カテゴリー名"
                    : "チャンネル名"}
                </label>
                <input
                  type="text"
                  value={nameValue()}
                  onInput={(e) => setNameValue(e.currentTarget.value)}
                  placeholder={selectedMode() === "category"
                    ? "カテゴリー名を入力"
                    : "チャンネル名を入力"}
                  class="w-full p-3 bg-gray-800 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200"
                  required
                />
              </div>

              <div class="pt-4">
                <button
                  type="submit"
                  disabled={!nameValue().trim()}
                  class={`w-full py-3 px-4 rounded-md font-medium transition-all duration-200 
                      ${
                    !nameValue().trim() ? "opacity-50 cursor-not-allowed " : ""
                  }
                      ${
                    selectedMode() === "category"
                      ? "bg-green-500 hover:bg-green-600"
                      : "bg-blue-500 hover:bg-blue-600"
                  } text-white shadow-md hover:shadow-lg transform hover:-translate-y-0.5`}
                >
                  {selectedMode() === "category"
                    ? "カテゴリーを作成"
                    : "チャンネルを作成"}
                </button>
              </div>
            </form>
          </div>
        </PopUpFrame>
      )}
    </>
  );
}
