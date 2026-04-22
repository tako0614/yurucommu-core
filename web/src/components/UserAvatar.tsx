import { Show } from "solid-js";

interface UserAvatarProps {
  avatarUrl: string | null;
  name: string;
  size?: number | "small" | "medium" | "large";
  class?: string;
}

export function UserAvatar(props: UserAvatarProps) {
  const getInitial = (name: string) => name.charAt(0).toUpperCase();

  const namedSizes: Record<string, number> = {
    small: 32,
    medium: 36,
    large: 40,
  };

  const pixelSize = () => {
    const s = props.size ?? "medium";
    return typeof s === "number" ? s : namedSizes[s];
  };
  const fontSize = () => {
    const px = pixelSize();
    return px < 32
      ? "text-xs"
      : px < 40
      ? "text-sm"
      : px < 56
      ? "text-base"
      : "text-xl";
  };

  return (
    <div
      class={`rounded-full bg-neutral-700 flex items-center justify-center shrink-0 overflow-hidden ${
        props.class ?? ""
      }`}
      style={{ width: `${pixelSize()}px`, height: `${pixelSize()}px` }}
    >
      <Show
        when={props.avatarUrl}
        fallback={
          <span class={`text-neutral-300 ${fontSize()}`}>
            {getInitial(props.name)}
          </span>
        }
      >
        <img
          src={props.avatarUrl!}
          alt={props.name}
          class="w-full h-full object-cover"
        />
      </Show>
    </div>
  );
}
