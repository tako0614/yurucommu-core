import { useSetAtom } from "solid-jotai";
import { pathState } from "./state.ts";

export function useNavigate() {
  const setPath = useSetAtom(pathState);
  return (path: string) => {
    globalThis.history.pushState({}, "", path);
    setPath(path.replace(/\/$/, ""));
  };
}

export interface Instance {
  host: string;
}

export interface Status {
  login: boolean;
  rootDomain?: string;
  termsRequired?: boolean;
}

export async function fetchStatus(): Promise<Status> {
  const res = await fetch("/auth/status");
  if (!res.ok) return { login: false };
  const data = await res.json();
  return {
    login: data.login as boolean,
    rootDomain: data.rootDomain,
    termsRequired: data.termsRequired,
  };
}

export async function login(
  userName: string,
  password: string,
): Promise<boolean> {
  const res = await fetch("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userName, password }),
  });
  return res.ok;
}

export async function register(
  userName: string,
  email: string,
  password: string,
  accepted: boolean,
): Promise<boolean> {
  const res = await fetch("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userName, email, password, accepted }),
  });
  return res.ok;
}

export async function verify(
  userName: string,
  code: string,
): Promise<boolean> {
  const res = await fetch("/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userName, code }),
  });
  return res.ok;
}

export async function resend(userName: string): Promise<boolean> {
  const res = await fetch("/auth/resend", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userName }),
  });
  return res.ok;
}

export async function logout(): Promise<void> {
  await fetch("/auth/logout", { method: "DELETE" });
}

export async function fetchInstances(): Promise<Instance[]> {
  const res = await fetch("/user/instances");
  if (!res.ok) return [];
  return await res.json();
}

export async function addInstance(
  host: string,
  password?: string,
): Promise<boolean> {
  const res = await fetch("/user/instances", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ host, password }),
  });
  return res.ok;
}

export async function deleteInstance(host: string): Promise<boolean> {
  const res = await fetch(`/user/instances/${host}`, { method: "DELETE" });
  return res.ok;
}

export async function updateInstancePassword(
  host: string,
  password?: string,
): Promise<boolean> {
  const res = await fetch(`/user/instances/${host}/password`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  return res.ok;
}

export async function restartInstance(host: string): Promise<boolean> {
  const res = await fetch(`/user/instances/${host}/restart`, {
    method: "POST",
  });
  return res.ok;
}

// FASP Providers
export interface FaspProvider {
  name: string;
  baseUrl: string;
  serverId: string;
  faspId?: string;
  status: string;
  capabilities?: Record<string, { version: string; enabled: boolean }>;
  updatedAt?: string | null;
}

export async function fetchFaspProviders(): Promise<FaspProvider[]> {
  const res = await fetch("/api/fasp/providers");
  if (!res.ok) return [];
  return await res.json();
}

export async function deleteFaspProvider(serverId: string): Promise<boolean> {
  const res = await fetch(`/api/fasp/providers/${serverId}`, { method: "DELETE" });
  return res.ok;
}

/**
 * MLS handshake via REST API.
 * Clients MUST use this function to send MLS handshake payloads (base64 MLS bytes etc.).
 * Servers reject handshakes sent over WebSocket — use REST: POST /api/rooms/:room/handshakes
 */
export async function sendHandshake(
  roomId: string,
  payload: {
    from: string;
    to: string[];
    content: string;
    mediaType?: string;
    encoding?: string;
    attachments?: unknown[];
  },
): Promise<{ ok: true; id?: string } | { ok: false; error?: string }> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/handshakes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    try {
      const data = await res.json();
      return { ok: false, error: data.error ?? res.statusText };
    } catch {
      return { ok: false, error: res.statusText };
    }
  }
  try {
    const data = await res.json();
    return { ok: true, id: data.id };
  } catch {
    return { ok: true };
  }
}
