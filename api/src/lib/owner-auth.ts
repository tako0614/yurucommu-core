import type { PublicAccountBindings as Bindings } from "@takos/platform/server";

export const HANDLE_REGEX = /^[a-z0-9_]{3,32}$/;

export function normalizeHandle(input: string): string {
  return (input || "").trim().toLowerCase();
}

export function isValidHandle(handle: string): boolean {
  return HANDLE_REGEX.test(handle);
}

export function resolveOwnerHandle(env: Bindings): string {
  const preferred =
    typeof (env as any).INSTANCE_OWNER_HANDLE === "string"
      ? normalizeHandle((env as any).INSTANCE_OWNER_HANDLE)
      : "";
  if (preferred && isValidHandle(preferred)) {
    return preferred;
  }

  const legacy =
    typeof (env as any).AUTH_USERNAME === "string"
      ? normalizeHandle((env as any).AUTH_USERNAME)
      : "";
  if (legacy && isValidHandle(legacy)) {
    return legacy;
  }

  return "owner";
}

const isOwnerHandle = (handle: string | null | undefined, env: Bindings) => {
  const ownerHandle = resolveOwnerHandle(env);
  const normalized = normalizeHandle(handle || "");
  return !!ownerHandle && !!normalized && ownerHandle === normalized;
};

export function isOwnerUser(user: any, env: Bindings): boolean {
  if (!user || typeof user?.id !== "string") return false;
  return isOwnerHandle(user.id, env);
}

const hasOwnerFlag = (candidate: any, ownerHandle: string): boolean => {
  if (!candidate || !ownerHandle) return false;
  const declaredOwner = (candidate as any).owner_id ?? (candidate as any).ownerId;
  if (typeof declaredOwner === "string" && declaredOwner.trim()) {
    return normalizeHandle(declaredOwner) === ownerHandle;
  }
  return false;
};

export type OwnerActorValidator = (
  candidate: any,
  ownerHandle: string,
) => Promise<boolean> | boolean;

export const buildOwnerActorValidator = (
  listAccountsByUser?: (userId: string) => Promise<any[]>,
): OwnerActorValidator => {
  return async (candidate: any, ownerHandle: string): Promise<boolean> => {
    const normalizedOwner = normalizeHandle(ownerHandle);
    if (!candidate || !normalizedOwner) return false;

    const candidateId = normalizeHandle((candidate as any)?.id ?? "");
    if (!candidateId) return false;
    if (candidateId === normalizedOwner) return true;
    if (hasOwnerFlag(candidate, normalizedOwner)) return true;

    if (typeof listAccountsByUser !== "function") return false;
    const accounts = await listAccountsByUser(candidateId).catch(() => []);
    const expectedAccountId = `${normalizedOwner}:${candidateId}`;
    return accounts.some((account: any) => {
      const provider = normalizeHandle((account as any)?.provider ?? "");
      const accountId = String((account as any)?.provider_account_id ?? "")
        .trim()
        .toLowerCase();
      return provider === "owner" && accountId === expectedAccountId;
    });
  };
};

export async function selectActiveUser(
  requestedUserId: string | null,
  baseUser: any,
  env: Bindings,
  fetchUser: (id: string) => Promise<any | null>,
  ownsUser?: OwnerActorValidator,
): Promise<{ user: any; activeUserId: string | null }> {
  if (!baseUser?.id) {
    return { user: baseUser, activeUserId: baseUser?.id ?? null };
  }

  const baseId = normalizeHandle(baseUser.id);
  if (!requestedUserId) {
    return { user: baseUser, activeUserId: baseUser.id };
  }

  const requestedId = normalizeHandle(requestedUserId);
  if (!requestedId || !isValidHandle(requestedId)) {
    return { user: baseUser, activeUserId: baseUser.id };
  }

  if (requestedId === baseId) {
    return { user: baseUser, activeUserId: baseUser.id };
  }

  if (!isOwnerHandle(baseId, env)) {
    return { user: baseUser, activeUserId: baseUser.id };
  }

  const candidate = await fetchUser(requestedId);
  if (!candidate) {
    return { user: baseUser, activeUserId: baseUser.id };
  }

  const candidateId = normalizeHandle((candidate as any).id ?? "");
  if (!candidateId || candidateId !== requestedId) {
    return { user: baseUser, activeUserId: baseUser.id };
  }

  const owned = ownsUser ? await ownsUser(candidate, baseId) : hasOwnerFlag(candidate, baseId);
  if (!owned) {
    return { user: baseUser, activeUserId: baseUser.id };
  }

  return { user: candidate, activeUserId: candidate.id ?? baseUser.id };
}
