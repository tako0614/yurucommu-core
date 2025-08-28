// 既定の FASP を起動時に自動登録/承認し、provider_info を取得して能力を有効化する
import { createDB } from "../db/mod.ts";
import { faspFetch, notifyCapabilityActivation } from "./fasp.ts";

function normalizeBaseUrl(url: string): string | null {
  let b = url.trim();
  if (!b) return null;
  if (!/^https?:\/\//i.test(b)) b = `https://${b}`;
  try {
    const u = new URL(b);
    u.hash = "";
    u.search = "";
    let p = u.pathname.replace(/\/+$/, "");
    if (p.endsWith("/provider_info")) {
      p = p.slice(0, -"/provider_info".length);
    }
    if (p === "/") p = "";
    const out = `${u.origin}${p}`.replace(/\/$/, "");
    return out;
  } catch {
    return null;
  }
}

function genSecret(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return btoa(String.fromCharCode(...buf));
}

export async function bootstrapDefaultFasp(
  env: Record<string, string>,
  domain: string,
) {
  const base = env["FASP_DEFAULT_BASE_URL"] ?? "";
  const normalized = normalizeBaseUrl(base);
  if (!normalized) return; // 既定 FASP 未設定

  const db = createDB(env);
  const now = new Date();
  const existing = await db.faspProviders.findOne({ baseUrl: normalized });

  let secret = existing?.secret as string | undefined;
  if (!secret) secret = genSecret();

  // name は一旦 baseUrl を既定値として保存
  const serverId = existing?.serverId ?? `default:${crypto.randomUUID()}`;
  try {
    await db.faspProviders.upsertByBaseUrl(
      normalized,
      {
        name: existing?.name ?? normalized,
        baseUrl: normalized,
        serverId,
        status: "approved",
        secret,
        updatedAt: now,
        rejectedAt: null,
        approvedAt: existing?.approvedAt ?? now,
      },
      { faspId: crypto.randomUUID(), createdAt: now },
    );
  } catch (e) {
    console.warn(
      "既定 FASP の登録に失敗しました",
      normalized,
      e instanceof Error ? e.message : String(e),
    );
    return;
  }

  // provider_info を取得して capabilities を反映（既定では全て有効化）
  try {
    const res = await faspFetch(env, domain, `${normalized}/provider_info`, {
      verifyResponseSignature: false,
    });
    if (!res.ok) return;
    const info = await res.json() as {
      name?: string;
      capabilities?: { id: string; version: string }[];
    };
    const name = info.name?.trim() || normalized;
    const capsArr = Array.isArray(info.capabilities) ? info.capabilities : [];
    const newCaps: Record<string, { version: string; enabled: boolean }> = {};
    for (const c of capsArr) {
      if (!c?.id || !c?.version) continue;
      newCaps[c.id] = { version: c.version, enabled: true };
    }

    const after = await db.faspProviders.updateByBaseUrl(
      normalized,
      { name, capabilities: newCaps, updatedAt: new Date() },
    );

    // 有効化を FASP 側へ通知
    await Promise.all(
      Object.entries(newCaps).map(([id, v]) =>
        notifyCapabilityActivation(env, domain, normalized, id, v.version, true)
      ),
    );

    return after;
  } catch (e) {
    console.warn(
      "provider_info の取得に失敗しました",
      normalized,
      e instanceof Error ? e.message : String(e),
    );
    // 起動継続のために黙殺
  }
}
