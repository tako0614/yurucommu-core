import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

let apiBase = import.meta.env.VITE_API_BASE ||
  localStorage.getItem("takos-api-base") ||
  "";

export function setApiBase(url: string) {
  apiBase = url;
  localStorage.setItem("takos-api-base", url);
}

export function getApiBase(): string {
  return apiBase;
}

export function apiUrl(path: string): string {
  return apiBase ? `${apiBase}${path}` : path;
}

export function isTauri(): boolean {
  if (typeof window === "undefined") return false; // SSR/Node 対策
  return (
    "__TAURI__" in window || // Tauri v1 〜 v2 β
    "__TAURI_INTERNALS__" in window // v2 α〜β 一部で採用
  );
}

// サーバーから取得したドメインを保持
let domain = "";

export async function apiFetch(path: string, init?: RequestInit) {
  // Tauri環境判定
  const is = isTauri();
  console.log("isTauri:" + is);
  let res: Response;
  try {
    res = is ? await tauriFetch(apiUrl(path), init) : await fetch(
      apiUrl(path),
      {
        credentials: "include",
        ...(init ?? {}),
      },
    );
  } catch (err) {
    // ネットワークエラーはグローバルに通知
    globalThis.dispatchEvent(
      new CustomEvent("app:toast", {
        detail: {
          type: "error",
          title: "通信エラー",
          description:
            "サーバーへの接続に失敗しました。しばらくしてから再度お試しください。",
        },
      }),
    );
    throw err;
  }
  if (path.endsWith("/config")) {
    try {
      const data = await res.clone().json();
      if (data.domain) domain = data.domain;
    } catch {
      // ignore
    }
  }
  return res;
}

export function getOrigin(): string {
  return apiBase ? new URL(apiBase).origin : globalThis.location.origin;
}

if (!domain) {
  domain = import.meta.env.VITE_ACTIVITYPUB_DOMAIN ||
    new URL(getOrigin()).hostname;
}

export function getDomain(): string {
  return domain;
}

const DEFAULT_KP_POOL = 10;
export function getKpPoolSize(): number {
  const v = Number(
    import.meta.env.VITE_MLS_KP_POOL ||
      localStorage.getItem("takos-mls-kp-pool") || DEFAULT_KP_POOL,
  );
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : DEFAULT_KP_POOL;
}
export function setKpPoolSize(n: number) {
  if (Number.isFinite(n) && n > 0) {
    localStorage.setItem("takos-mls-kp-pool", String(Math.floor(n)));
  }
}

// --- 複数サーバー管理 ---

const SERVERS_KEY = "takos-servers";
const ACTIVE_SERVER_KEY = "takos-active-server";

export function getServers(): string[] {
  const raw = localStorage.getItem(SERVERS_KEY);
  try {
    return raw ? JSON.parse(raw) as string[] : [];
  } catch {
    return [];
  }
}

export function addServer(url: string) {
  const list = getServers();
  if (!list.includes(url)) {
    list.push(url);
    localStorage.setItem(SERVERS_KEY, JSON.stringify(list));
  }
}

export function getActiveServer(): string | null {
  return localStorage.getItem(ACTIVE_SERVER_KEY);
}

export function setActiveServer(url: string) {
  localStorage.setItem(ACTIVE_SERVER_KEY, url);
}
