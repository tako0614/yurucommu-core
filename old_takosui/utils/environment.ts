/**
 * Tauriアプリ内で実行されているかどうかを判定します
 * @returns Tauriアプリ内ならtrue、そうでなければfalse
 */
export function isTauri(): boolean {
  return typeof window !== "undefined" &&
    // 現在のURLがtauri://でスタートする、または
    (window.location.protocol === "tauri:" ||
      // カスタムスキーマのローカルホストURLを使用している場合
      window.location.hostname === "tauri.localhost" ||
      // Tauri 2.0の特別なフラグがある場合
      (window as any).__TAURI_INTERNALS__ !== undefined);
}

/**
 * ブラウザ上のモバイルデバイスで実行されているかを判定します
 * @returns モバイルデバイスならtrue、そうでなければfalse
 */
export function isMobile(): boolean {
  return /android|iphone|ipad|ipod/i.test(
    typeof navigator !== "undefined" ? navigator.userAgent.toLowerCase() : "",
  );
}

/**
 * Tauriモバイルアプリで実行されているかを判定します
 * @returns TauriモバイルアプリならtrueそうでなければfalseS
 */
export function isTauriMobile(): boolean {
  return isTauri() && isMobile();
}
