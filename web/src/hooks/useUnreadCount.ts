import { useEffect, useState } from 'react';
import { fetchUnreadCount } from '../lib/api';

export function useUnreadCount(pollIntervalMs = 30000) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const next = await fetchUnreadCount();
        if (active) setCount(next);
      } catch (e) {
        console.error('Failed to fetch unread count:', e);
      }
    };

    load();

    if (pollIntervalMs > 0) {
      const intervalId = setInterval(load, pollIntervalMs);
      return () => {
        active = false;
        clearInterval(intervalId);
      };
    }

    return () => {
      active = false;
    };
  }, [pollIntervalMs]);

  return count;
}
