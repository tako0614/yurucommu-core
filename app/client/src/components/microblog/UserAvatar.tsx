import { createSignal } from "solid-js";

// ユーザーアバターコンポーネント
export function UserAvatar(props: {
  avatarUrl?: string;
  username: string;
  size?: string;
  className?: string;
  isExternal?: boolean;
}) {
  const [imageError, setImageError] = createSignal(false);
  const size = props.size || "w-12 h-12";

  const getInitials = (name: string) => {
    // URLやメールアドレス形式の場合の処理を改善
    let displayName = name;
    
    // URLの場合は最後の部分を取得
    if (name.startsWith("http")) {
      try {
        const url = new URL(name);
        const pathParts = url.pathname.split("/");
        displayName = pathParts[pathParts.length - 1] || "EU";
      } catch {
        displayName = "EU"; // External User
      }
    } else if (name.includes("@")) {
      // メールアドレス形式の場合は@より前を取得
      displayName = name.split("@")[0];
    }
    
    const words = displayName.split(/[\s\-_]+/); // スペース、ハイフン、アンダースコアで分割
    if (words.length >= 2) {
      return words[0].charAt(0).toUpperCase() +
        words[1].charAt(0).toUpperCase();
    }
    return displayName.charAt(0).toUpperCase() || "?";
  };

  const getGradientColor = (username: string) => {
    const colors = [
      "from-purple-500 to-pink-600",
      "from-blue-500 to-purple-600",
      "from-green-500 to-teal-600",
      "from-orange-500 to-red-600",
      "from-indigo-500 to-blue-600",
      "from-pink-500 to-rose-600",
      "from-teal-500 to-cyan-600",
      "from-yellow-500 to-orange-600",
    ];
    const index = username.charCodeAt(0) % colors.length;
    return colors[index];
  };

  return (
    <div class="relative">
      {(props.avatarUrl && props.avatarUrl !== "" && !imageError())
        ? (
          <img
            src={props.avatarUrl}
            alt={`${props.username}'s avatar`}
            class={`${size} rounded-full object-cover border-2 ${
              props.isExternal ? "border-blue-500/50" : "border-gray-700"
            } shadow-md hover:shadow-lg transition-shadow ${
              props.className || ""
            }`}
            onError={() => setImageError(true)}
            loading="lazy"
          />
        )
        : (
          <div
            class={`${size} bg-gradient-to-br ${
              getGradientColor(props.username)
            } rounded-full flex items-center justify-center border-2 ${
              props.isExternal ? "border-blue-500/50" : "border-gray-700"
            } shadow-md hover:shadow-lg transition-shadow ${
              props.className || ""
            }`}
          >
            <span class="text-white font-bold text-sm select-none">
              {getInitials(props.username)}
            </span>
          </div>
        )}
      {props.isExternal && (
        <div class="absolute -bottom-1 -right-1 w-4 h-4 bg-blue-500 rounded-full border-2 border-gray-900 flex items-center justify-center">
          <svg class="w-2 h-2 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </div>
      )}
    </div>
  );
}
