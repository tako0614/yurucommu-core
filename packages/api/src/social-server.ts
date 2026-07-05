import { apiFetch, assertOk } from "./lib/api/fetch.ts";
import type { Actor } from "./types/index.ts";

export interface SocialServerDiscovery {
  readonly product: "yurucommu";
  readonly name: string;
  readonly server: {
    readonly id: "yurucommu-server";
    readonly name: string;
    readonly canonicalOrigin: string;
    readonly activitypubOrigin: string;
  };
  readonly clients: readonly {
    readonly id: "yurucommu" | "yurume";
    readonly name: string;
    readonly defaultEntry: "feed" | "messages";
  }[];
  readonly issuer: string;
  readonly apiBaseUrl: string;
  readonly activitypubOrigin: string;
  readonly mediaOrigin: string;
  readonly socialServerCapabilitiesUrl: string;
  readonly capabilities: readonly string[];
  readonly endpoints: {
    readonly api: string;
    readonly authProviders: string;
    readonly currentUser: string;
    readonly timeline: string;
    readonly conversations: string;
    readonly notifications: string;
    readonly mobilePushRegistrations: string;
  };
}

export async function fetchCurrentActor(): Promise<Actor | null> {
  const res = await apiFetch("/api/auth/me");
  if (res.status === 401 || res.status === 403) return null;
  await assertOk(res, "Failed to load current user");
  const data = (await res.json()) as { actor?: Actor | null };
  return data.actor ?? null;
}

export async function fetchSocialServerDiscovery(): Promise<SocialServerDiscovery> {
  const res = await apiFetch("/.well-known/social-server");
  await assertOk(res, "Failed to load social server discovery");
  return (await res.json()) as SocialServerDiscovery;
}
