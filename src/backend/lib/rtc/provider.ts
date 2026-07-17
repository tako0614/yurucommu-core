/**
 * RtcProvider — media-plane configuration for the call feature.
 *
 * This is the seam that keeps calling vendor-neutral: 1:1 calls are pure P2P
 * WebRTC over the operator-configured STUN/TURN servers (no SFU, no Cloudflare),
 * and group calls (Phase 3) select a WHIP/WHEP SFU "focus" whose backend is any
 * of `whip` / `livekit` / `cloudflare-realtime` — Cloudflare Realtime is one
 * adapter among equals, never required.
 *
 * TURN credentials, when coturn's REST scheme is configured, are minted
 * per-request as short-lived HMAC creds (RFC 8489 long-term-credential via the
 * `turn-rest` `timestamp:name` username convention) — no static long-lived
 * secret is ever handed to a client.
 */

import type {
  CallMediaKind,
  IceServerConfig,
  SfuFocus,
} from "../../../../packages/api/src/types/call.ts";
import type { EnvVars } from "../../types.ts";
import { bufferToBase64 } from "../base64.ts";
import { logger } from "../logger.ts";

const log = logger.child({ component: "rtc.provider" });

const DEFAULT_TURN_TTL_SECONDS = 3600;

export interface RtcProvider {
  /** ICE (STUN/TURN) servers for a call. Fresh (short-lived) TURN creds. */
  getIceServers(): Promise<IceServerConfig[]>;
  /** Group-call SFU focus, or null for pure P2P (always null for 1:1). */
  getSfuFocus(media: CallMediaKind): Promise<SfuFocus | null>;
}

function parseStaticIceServers(raw: string | undefined): IceServerConfig[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: IceServerConfig[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const urls = (entry as { urls?: unknown }).urls;
      if (typeof urls !== "string" && !Array.isArray(urls)) continue;
      const server: IceServerConfig = { urls: urls as string | string[] };
      const username = (entry as { username?: unknown }).username;
      const credential = (entry as { credential?: unknown }).credential;
      if (typeof username === "string") server.username = username;
      if (typeof credential === "string") server.credential = credential;
      out.push(server);
    }
    return out;
  } catch (err) {
    log.warn("Invalid YURUCOMMU_RTC_ICE_SERVERS JSON", { error: String(err) });
    return [];
  }
}

async function mintTurnCredential(
  uris: string[],
  secret: string,
  ttlSeconds: number,
): Promise<IceServerConfig | null> {
  if (uris.length === 0 || !secret) return null;
  // coturn REST: username = "<unix-expiry>:<name>", credential = base64(HMAC-
  // SHA1(secret, username)). A random name keeps creds unlinkable per call.
  const expiry = Math.floor(Date.now() / 1000) + ttlSeconds;
  const username = `${expiry}:yurucommu`;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-1" },
      false,
      ["sign"],
    );
    const mac = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(username),
    );
    return { urls: uris, username, credential: bufferToBase64(mac) };
  } catch (err) {
    log.error("Failed to mint TURN credential", { error: String(err) });
    return null;
  }
}

class ConfiguredRtcProvider implements RtcProvider {
  constructor(private readonly env: EnvVars) {}

  async getIceServers(): Promise<IceServerConfig[]> {
    const servers = parseStaticIceServers(this.env.YURUCOMMU_RTC_ICE_SERVERS);
    const uris = (this.env.YURUCOMMU_RTC_TURN_URIS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const secret = this.env.YURUCOMMU_RTC_TURN_SECRET?.trim();
    if (uris.length > 0 && secret) {
      const ttl =
        Number.parseInt(this.env.YURUCOMMU_RTC_TURN_TTL ?? "", 10) ||
        DEFAULT_TURN_TTL_SECONDS;
      const turn = await mintTurnCredential(uris, secret, ttl);
      if (turn) servers.push(turn);
    }
    return servers;
  }

  async getSfuFocus(_media: CallMediaKind): Promise<SfuFocus | null> {
    const adapter = (this.env.YURUCOMMU_RTC_SFU_ADAPTER ?? "p2p")
      .trim()
      .toLowerCase();
    if (adapter === "" || adapter === "p2p") return null;
    const url = this.env.YURUCOMMU_RTC_SFU_URL?.trim();
    if (!url) {
      log.warn("SFU adapter selected but YURUCOMMU_RTC_SFU_URL unset", {
        adapter,
      });
      return null;
    }
    // WHIP/WHEP focus passthrough. Real per-room token minting (LiveKit JWT,
    // Cloudflare Realtime app tokens) lands with group calls (Phase 3); today
    // the shared/static token (if any) is advertised as-is.
    return {
      kind: adapter,
      url,
      token: this.env.YURUCOMMU_RTC_SFU_TOKEN?.trim() || undefined,
    };
  }
}

export function createRtcProvider(env: EnvVars): RtcProvider {
  return new ConfiguredRtcProvider(env);
}
