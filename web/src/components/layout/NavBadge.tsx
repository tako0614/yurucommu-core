import { Show } from "solid-js";

interface NavBadgeProps {
  count: number;
  // Optional accessible label, e.g. "3 unread notifications".
  label?: string;
}

// Small unread-count pill. Red follows the conventional unread/notification
// badge convention (white bold text, "99+" cap).
export function NavBadge(props: NavBadgeProps) {
  return (
    <Show when={props.count > 0}>
      <span
        aria-label={props.label}
        class="min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center"
      >
        {props.count > 99 ? "99+" : props.count}
      </span>
    </Show>
  );
}
