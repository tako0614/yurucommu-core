import { Member, Room, Message } from '../types';

const CACHE_KEY_PREFIX = 'yurucommu_cache_';

export function getCachedMessages(roomId: string): Message[] {
  try {
    const cached = localStorage.getItem(`${CACHE_KEY_PREFIX}messages_${roomId}`);
    return cached ? JSON.parse(cached) : [];
  } catch {
    return [];
  }
}

export function setCachedMessages(roomId: string, messages: Message[]) {
  try {
    // Keep only last 100 messages in cache
    const toCache = messages.slice(-100);
    localStorage.setItem(`${CACHE_KEY_PREFIX}messages_${roomId}`, JSON.stringify(toCache));
  } catch {
    // Storage full, ignore
  }
}

export function getCachedMember(): Member | null {
  try {
    const cached = localStorage.getItem(`${CACHE_KEY_PREFIX}member`);
    return cached ? JSON.parse(cached) : null;
  } catch {
    return null;
  }
}

export function setCachedMember(member: Member | null) {
  try {
    if (member) {
      localStorage.setItem(`${CACHE_KEY_PREFIX}member`, JSON.stringify(member));
    } else {
      localStorage.removeItem(`${CACHE_KEY_PREFIX}member`);
    }
  } catch {
    // Storage full, ignore
  }
}

export function getCachedRooms(): Room[] {
  try {
    const cached = localStorage.getItem(`${CACHE_KEY_PREFIX}rooms`);
    return cached ? JSON.parse(cached) : [];
  } catch {
    return [];
  }
}

export function setCachedRooms(rooms: Room[]) {
  try {
    localStorage.setItem(`${CACHE_KEY_PREFIX}rooms`, JSON.stringify(rooms));
  } catch {
    // Storage full, ignore
  }
}
