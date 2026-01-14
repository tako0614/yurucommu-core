// Local storage cache utilities (minimal - most caching done by browser)

const CACHE_KEY_PREFIX = 'yurucommu_';

export function clearCache() {
  try {
    Object.keys(localStorage)
      .filter(key => key.startsWith(CACHE_KEY_PREFIX))
      .forEach(key => localStorage.removeItem(key));
  } catch {
    // Ignore
  }
}
