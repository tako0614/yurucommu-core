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
): Promise<{ success: boolean; redirect?: string }> {
  const res = await fetch("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userName, password }),
  });
  if (!res.ok) return { success: false };
  const data = await res.json().catch(() => ({} as Record<string, unknown>));
  return {
    success: true,
    redirect: typeof data.redirect === "string" ? data.redirect : undefined,
  };
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
