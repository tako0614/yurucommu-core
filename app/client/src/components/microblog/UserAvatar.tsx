import { createSignal } from "solid-js";

// ユーザーアバターコンポーネント
export function UserAvatar(props: {
  avatarUrl?: string;
  username: string;
  size?: string;
  className?: string;
}) {
  const [imageError, setImageError] = createSignal(false);
  const size = props.size || "w-12 h-12";

  const getInitials = (name: string) => {
    const words = name.split(" ");
    if (words.length >= 2) {
      return words[0].charAt(0).toUpperCase() +
        words[1].charAt(0).toUpperCase();
    }
    return name.charAt(0).toUpperCase();
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
    <>
      {(props.avatarUrl && props.avatarUrl !== "" && !imageError())
        ? (
          <img
            src={props.avatarUrl}
            alt={`${props.username}'s avatar`}
            class={`${size} rounded-full object-cover border-2 border-gray-700 shadow-md hover:shadow-lg transition-shadow ${
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
            } rounded-full flex items-center justify-center border-2 border-gray-700 shadow-md hover:shadow-lg transition-shadow ${
              props.className || ""
            }`}
          >
            <span class="text-white font-bold text-sm select-none">
              {getInitials(props.username)}
            </span>
          </div>
        )}
    </>
  );
}
