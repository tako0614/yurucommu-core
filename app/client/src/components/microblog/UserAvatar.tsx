import { createSignal } from "solid-js";
import { isDataUrl, isUrl } from "../home/types.ts";

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

  // helpers removed: initials/gradient fallback replaced by default image

  return (
    <div class="relative">
      {(props.avatarUrl && props.avatarUrl !== "" && !imageError() && (isDataUrl(props.avatarUrl) || isUrl(props.avatarUrl)))
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
          <img
            src="/takos.png"
            alt="default avatar"
            class={`${size} rounded-full object-cover border-2 ${
              props.isExternal ? "border-blue-500/50" : "border-gray-700"
            } shadow-md hover:shadow-lg transition-shadow ${
              props.className || ""
            }`}
            loading="lazy"
          />
        )}
      {props.isExternal && (
        <div class="absolute -bottom-1 -right-1 w-4 h-4 bg-blue-500 rounded-full border-2 border-gray-900 flex items-center justify-center">
          <svg
            class="w-2 h-2 text-white"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="3"
              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
            />
          </svg>
        </div>
      )}
    </div>
  );
}
