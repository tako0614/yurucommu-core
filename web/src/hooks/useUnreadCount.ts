import { createEffect, createSignal, onCleanup } from "solid-js";
import { fetchUnreadCount } from "../lib/api.ts";

export function useUnreadCount(pollIntervalMs = 30000) {
  const [count, setCount] = createSignal(0);

  createEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const next = await fetchUnreadCount();
        if (active) setCount(next);
      } catch (e) {
        console.error("Failed to fetch unread count:", e);
      }
    };

    load();

    if (pollIntervalMs > 0) {
      const intervalId = setInterval(load, pollIntervalMs);
      onCleanup(() => {
        active = false;
        clearInterval(intervalId);
      });
    } else {
      onCleanup(() => {
        active = false;
      });
    }
  });

  return count;
}
