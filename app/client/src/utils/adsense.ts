import { apiFetch } from "./config.ts";

interface AdsenseConfig {
  client: string | null;
  slot: string | null;
  account: string | null;
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
      };
    }
  } catch {
    config = null;
  }
  return config;
}

export function isAdsenseEnabled(): boolean {
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
