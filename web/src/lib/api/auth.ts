import type { Actor } from '../../types';
import { normalizeActor } from './normalize';
import { apiFetch, apiPost } from './fetch';

export async function fetchMe(): Promise<{ authenticated: boolean; actor?: Actor }> {
  const res = await apiFetch('/api/auth/me');
  if (!res.ok) return { authenticated: false };
  const data = (await res.json()) as { actor?: Actor };
  if (data.actor) {
    return { authenticated: true, actor: normalizeActor(data.actor) };
  }
  return { authenticated: false };
}

export async function login(password: string): Promise<{ success: boolean; error?: string }> {
  const res = await apiPost('/api/auth/login', { password });
  return (await res.json()) as { success: boolean; error?: string };
}

export async function logout(): Promise<void> {
  await apiPost('/api/auth/logout');
}

export interface AccountInfo {
  ap_id: string;
  preferred_username: string;
  name: string | null;
  icon_url: string | null;
}

export async function fetchAccounts(): Promise<{ accounts: AccountInfo[]; current_ap_id: string }> {
  const res = await apiFetch('/api/auth/accounts');
  if (!res.ok) throw new Error('Failed to fetch accounts');
  return (await res.json()) as { accounts: AccountInfo[]; current_ap_id: string };
}

export async function switchAccount(apId: string): Promise<void> {
  const res = await apiPost('/api/auth/switch', { ap_id: apId });
  if (!res.ok) throw new Error('Failed to switch account');
}

export async function createAccount(username: string, name?: string): Promise<AccountInfo> {
  const res = await apiPost('/api/auth/accounts', { username, name });
  if (!res.ok) {
    const data = (await res.json()) as { error?: string };
    throw new Error(data.error || 'Failed to create account');
  }
  const data = (await res.json()) as { account: AccountInfo };
  return data.account;
}
