import { useAtom } from "solid-jotai";
import { createSignal } from "solid-js";
import {
  descriptionState,
  iconState,
  nicknameState,
} from "../../../utils/state";
import { homeSelectedAtom } from "../home";
import { TakosFetch } from "../../../utils/TakosFetch";
import { userId } from "../../../utils/userId";

// プロフィール設定コンポーネント
export function ProfileSettings() {
  const [selected, setSelected] = useAtom(homeSelectedAtom);
  const [nickName, setNickName] = useAtom(nicknameState);
  const [icon, setIcon] = useAtom(iconState);
  const [description, setDescription] = useAtom(descriptionState);

  const [newNickName, setNewNickName] = createSignal(nickName());
  const [newDescription, setNewDescription] = createSignal(description());
  const [newIcon, setNewIcon] = createSignal(icon());

  const handleIconChange = (e: Event) => {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];

    if (!file) return;

    // ファイルが画像かどうかを確認
    if (!file.type.startsWith("image/")) {
      alert("画像ファイルを選択してください");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      if (!e.target?.result) return;

      // Base64文字列を取得（data:image/xxx;base64, プレフィックスを除去）
      const base64String = e.target.result.toString().split(",")[1];
      setNewIcon(base64String);
    };

    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    let isFailed = false;
    const iconData = newIcon();
    const nickNameData = newNickName();
    const descriptionData = newDescription();
    if (iconData !== icon()) {
      const iconRes = await TakosFetch("/api/v2/profile/icon", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ icon: iconData }),
      });
      if (iconRes.status !== 200) {
        isFailed = true;
      }
    }
    if (nickNameData !== nickName()) {
      const nickNameRes = await TakosFetch("/api/v2/profile/nickName", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ nickName: nickNameData }),
      });
      if (nickNameRes.status !== 200) {
        isFailed = true;
      }
    }
    if (descriptionData !== description()) {
      const descriptionRes = await TakosFetch("/api/v2/profile/description", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ description: descriptionData }),
      });
      if (descriptionRes.status !== 200) {
        isFailed = true;
      }
    }
    if (isFailed) {
      alert("保存に失敗しました");
    }
    setSelected("settings"); // 保存後は設定メニューに戻る
    if (iconData !== icon()) setIcon(iconData);
    if (nickNameData !== nickName()) setNickName(nickNameData);
    if (descriptionData !== description()) setDescription(descriptionData);
  };

  return (
    <div class="p-4">
      <div class="flex items-center justify-between mb-5">
        <button
          class="text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1"
          onClick={() => setSelected("settings")}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M10 19l-7-7m0 0l7-7m-7 7h18"
            />
          </svg>
          戻る
        </button>
        <h3 class="text-lg font-bold">プロフィール設定</h3>
        <div class="w-10"></div> {/* スペースバランス用 */}
      </div>

      <div class="flex flex-col items-center gap-4 py-3">
        <div class="relative group">
          <img
            src={`data:image/png;base64,${newIcon()}`}
            alt="Profile"
            class="w-24 h-24 rounded-full object-cover border-2 border-blue-500/40 shadow-lg shadow-blue-500/10"
          />
          <label
            class="absolute bottom-1 right-1 bg-blue-500 hover:bg-blue-600 rounded-full p-2 cursor-pointer transition-all transform group-hover:scale-110 shadow-lg"
            title="画像を変更"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
              />
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
            <input
              type="file"
              class="hidden"
              accept="image/*"
              onChange={handleIconChange}
            />
          </label>
        </div>
        <div class="text-center">
          <p class="text-xs text-gray-400 bg-gray-800/50 px-3 py-1 rounded-full">
            {userId}
          </p>
        </div>
      </div>

      <div>
        <label class="block text-sm font-medium text-gray-300 mb-1">
          ニックネーム
        </label>
        <input
          type="text"
          value={newNickName()!}
          onInput={(e) => setNewNickName(e.target.value)}
          class="w-full p-3 bg-gray-800/70 border border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
        />
      </div>

      <div>
        <label class="block text-sm font-medium text-gray-300 mb-1">
          自己紹介
        </label>
        <textarea
          value={newDescription()!}
          onInput={(e) => setNewDescription(e.target.value)}
          class="w-full p-3 bg-gray-800/70 border border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all min-h-[100px] resize-none"
        />
      </div>

      <button
        class="w-full p-3 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors font-medium shadow-lg shadow-blue-900/20 transform hover:translate-y-[-1px] active:translate-y-[1px]"
        onClick={handleSave}
      >
        保存する
      </button>
    </div>
  );
}
