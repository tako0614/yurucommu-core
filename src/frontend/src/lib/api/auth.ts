import type { Actor } from '../../types';
import { normalizeActor } from './normalize';

export async function fetchMe(): Promise<{ authenticated: boolean; actor?: Actor }> {
  const res = await fetch('/api/auth/me');
  if (!res.ok) return { authenticated: false };
  const data = (await res.json()) as { actor?: Actor };
  if (data.actor) {
    return { authenticated: true, actor: normalizeActor(data.actor) };
  }
  return { authenticated: false };
}

export async function login(password: string): Promise<{ success: boolean; error?: string }> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  return (await res.json()) as { success: boolean; error?: string };
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' });
}

export interface AccountInfo {
  ap_id: string;
  preferred_username: string;
  name: string | null;
  icon_url: string | null;
}

export async function fetchAccounts(): Promise<{ accounts: AccountInfo[]; current_ap_id: string }> {
  const res = await fetch('/api/auth/accounts');
  if (!res.ok) throw new Error('Failed to fetch accounts');
  return (await res.json()) as { accounts: AccountInfo[]; current_ap_id: string };
}

export async function switchAccount(apId: string): Promise<void> {
  const res = await fetch('/api/auth/switch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ap_id: apId }),
  });
  if (!res.ok) throw new Error('Failed to switch account');
}

export async function createAccount(username: string, name?: string): Promise<AccountInfo> {
  const res = await fetch('/api/auth/accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, name }),
  });
  if (!res.ok) {
    const data = (await res.json()) as { error?: string };
    throw new Error(data.error || 'Failed to create account');
  }
  const data = (await res.json()) as { account: AccountInfo };
  return data.account;
}
