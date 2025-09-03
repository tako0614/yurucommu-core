import { apiFetch } from "./config.ts";

interface AdsenseConfig {
  client: string | null;
  slot: string | null;
  account: string | null;
  // 任意の HTML 広告タグをサーバー側で渡すためのフィールド
  chatBannerHtml?: string | null;
  betweenPostsHtml?: string | null;
}

let config: AdsenseConfig | null = null;
let loaded = false;

export async function loadAdsenseConfig(): Promise<AdsenseConfig | null> {
  if (loaded) return config;
  loaded = true;
  try {
    const res = await apiFetch("/api/config");
    if (res.ok) {
      const data = await res.json();
      config = {
        client: data.adsenseClient ?? null,
        slot: data.adsenseSlot ?? null,
        account: data.adsenseAccount ?? null,
        chatBannerHtml: typeof data.chatBannerHtml === "string"
          ? data.chatBannerHtml
          : null,
        betweenPostsHtml: typeof data.betweenPostsHtml === "string"
          ? data.betweenPostsHtml
          : null,
      };
    }
  } catch {
    config = null;
  }
  return config;
}
// Detect Tauri environment: prefer global hook or userAgent containing 'Tauri'
export function isTauri(): boolean {
  try {
    // Check for Tauri global -- intentionally using unknown to avoid any
    // @ts-ignore: checking existence of __TAURI__ injected in Tauri runtime
    if (typeof (globalThis as unknown as { __TAURI__?: unknown }).__TAURI__ !== "undefined") return true;
  } catch {
    // ignore
  }
  try {
    if (typeof navigator !== "undefined" && navigator.userAgent) {
      if (navigator.userAgent.includes("Tauri")) return true;
    }
  } catch {
    // ignore
  }
  return false;
}
export function isAdsenseEnabled(): boolean {
  // Tauri builds use AdMob; explicitly disable AdSense there
  if (isTauri()) return false;
  return !!(config?.client && config?.slot);
}

export function getAdsenseClient(): string | null {
  return config?.client ?? null;
}

export function getAdsenseSlot(): string | null {
  return config?.slot ?? null;
}

export function getAdsenseAccount(): string | null {
  return config?.account ?? null;
}

export function getChatBannerHtml(): string | null {
  return config?.chatBannerHtml ?? null;
}

export function getBetweenPostsHtml(): string | null {
  return config?.betweenPostsHtml ?? null;
}
