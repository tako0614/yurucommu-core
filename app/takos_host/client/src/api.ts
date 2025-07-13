export interface Instance {
  host: string;
}

export async function fetchStatus(): Promise<boolean> {
  const res = await fetch("/auth/status");
  if (!res.ok) return false;
  const data = await res.json();
  return data.login as boolean;
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

export async function logout(): Promise<void> {
  await fetch("/auth/logout", { method: "DELETE" });
}

export async function fetchInstances(): Promise<Instance[]> {
  const res = await fetch("/admin/instances");
  if (!res.ok) return [];
  return await res.json();
}

export async function addInstance(
  host: string,
  password: string,
): Promise<boolean> {
  const res = await fetch("/admin/instances", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ host, password }),
  });
  return res.ok;
}

export async function deleteInstance(host: string): Promise<boolean> {
  const res = await fetch(`/admin/instances/${host}`, { method: "DELETE" });
  return res.ok;
}
