import { Hono } from "hono";
import { getDB } from "../db/mod.ts";
import { getDomain } from "../utils/activitypub.ts";
import authRequired from "../utils/auth.ts";
import { getEnv } from "@takos/config";
import { faspFetch, getFaspBaseUrl } from "../services/fasp.ts";

interface SearchResult {
  type: "user" | "post";
  id: string;
  title: string;
  subtitle: string;
  avatar?: string;
  actor?: string;
  origin?: string;
  metadata?: { createdAt?: Date };
}

const app = new Hono();
app.use("/search/*", authRequired);

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function actorToHandle(actor: string): string {
  try {
    const url = new URL(actor);
    const name = url.pathname.split("/").pop() || "";
    return `@${name}@${url.hostname}`;
  } catch {
    return actor;
  }
}

function isPrivateIP(ip: string): boolean {
  const privateRanges = [
    /^10\./,
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
    /^192\.168\./,
    /^127\./,
    /^0\./,
    /^169\.254\./, // Link-local
    /^fc00:/i, // IPv6 Unique Local
    /^fd[0-9a-f]{2}:/i,
    /^fe80:/i, // IPv6 Link-local
    /^::1$/i, // IPv6 localhost
  ];

  return privateRanges.some((range) => range.test(ip));
}

async function validateServerHostname(hostname: string): Promise<boolean> {
  // 開発環境の場合は検証をスキップ
  const isDev = Deno.env.get("DEV") === "1";
  if (isDev) {
    return true;
  }

  // ローカルホストや内部アドレスのブロック
  const blockedHosts = [
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "169.254.169.254", // AWS metadata
    "::1",
    "::ffff:127.0.0.1",
  ];

  if (blockedHosts.includes(hostname.toLowerCase())) {
    return false;
  }

  // IPアドレスかどうかチェック
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  const ipv6Regex = /^([0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}$/i;

  if (ipv4Regex.test(hostname) || ipv6Regex.test(hostname)) {
    if (isPrivateIP(hostname)) {
      return false;
    }
  } else {
    // ホスト名の場合、DNSリゾルブして検証
    try {
      const resolvedIPs = await Deno.resolveDns(hostname, "A");
      for (const ip of resolvedIPs) {
        if (isPrivateIP(ip)) {
          return false;
        }
      }
    } catch {
      // IPv6も確認
      try {
        const resolvedIPv6 = await Deno.resolveDns(hostname, "AAAA");
        for (const ip of resolvedIPv6) {
          if (isPrivateIP(ip)) {
            return false;
          }
        }
      } catch {
        // DNS解決できない場合は許可（外部ドメインの可能性）
      }
    }
  }

  return true;
}

app.get("/search", async (c) => {
  const env = getEnv(c);
  let q = c.req.query("q")?.trim();
  const acct = c.req.query("acct")?.trim();
  const type = c.req.query("type") ?? "all";
  const useFasp = (c.req.query("useFasp") ?? "1") !== "0";
  if (!q && !acct) return c.json([]);

  let server: string | undefined;
  if (acct) {
    const parts = acct.split("@");
    if (parts.length === 2 && parts[0] && parts[1]) {
      q = parts[0];
      server = parts[1];
    }
  } else if (q?.includes("@")) {
    const parts = q.split("@");
    if (parts.length === 2 && parts[0] && parts[1]) {
      q = parts[0];
      server = parts[1];
    }
  }

  const results: SearchResult[] = [];

  // FASP に関係なく、acct が明示/暗黙に与えられている場合は WebFinger で存在確認して返す
  if (server) {
    const isValidServer = await validateServerHostname(server);
    if (isValidServer) {
      try {
        const resource = `acct:${q}@${server}`;
        const wfUrl = `https://${server}/.well-known/webfinger?resource=${encodeURIComponent(resource)}`;
        const wfRes = await fetch(wfUrl, { headers: { Accept: "application/jrd+json" } });
        if (wfRes.ok) {
          const jrd = await wfRes.json() as { links?: Array<{ rel?: string; type?: string; href?: string }> };
          const link = (jrd.links || []).find((l) =>
            (l.rel === "self" || l.rel === "http://webfinger.net/rel/profile-page") &&
            (typeof l.type === "string" && l.type.includes("activity+json")) &&
            typeof l.href === "string"
          );
          const actorUrl = link?.href;
          if (actorUrl) {
            const aRes = await fetch(actorUrl, {
              headers: {
                Accept:
                  'application/ld+json; profile="https://www.w3.org/ns/activitystreams"',
              },
            });
            if (aRes.ok) {
              const actor = await aRes.json() as { id?: string; name?: string; preferredUsername?: string; icon?: { url?: string } };
              const host = (() => { try { return new URL(actorUrl).hostname; } catch { return server; } })();
              const id = actor.id ?? actorUrl;
              results.push({
                type: "user",
                id,
                title: actor.name ?? actor.preferredUsername ?? `${q}@${server}`,
                subtitle: actor.preferredUsername ? `@${actor.preferredUsername}@${host}` : actorUrl,
                avatar: actor.icon?.url,
                actor: id,
                origin: host,
              });
            }
          }
        }
      } catch {
        // ignore webfinger failures
      }
    }
  }

  const results: SearchResult[] = [];
  if (!q) return c.json(results);
  const regex = new RegExp(escapeRegex(q), "i");

  if (type === "all" || type === "users") {
  const db = getDB(c);
  const users = await db.accounts.search(regex, 20);
    const domain = getDomain(c);
    for (const u of users) {
      results.push({
        type: "user",
        id: String(u._id),
        title: u.displayName,
        subtitle: `@${u.userName}`,
        avatar: u.avatarInitial,
        actor: `https://${domain}/users/${u.userName}`,
        origin: domain,
      });
    }

    const faspBase = useFasp
      ? await getFaspBaseUrl(env, "account_search")
      : null;
    if (faspBase && useFasp) {
      try {
        const perPage = 20;
        const maxTotal = 100;
        const seen = new Set(
          results.map((r) => r.actor).filter((a): a is string => Boolean(a)),
        );
  let nextUrl: string | undefined = `${faspBase}/account_search/v0/search?term=${
          encodeURIComponent(q)
        }&limit=${perPage}`;
        while (nextUrl && seen.size < maxTotal) {
          const res = await faspFetch(env, domain, nextUrl, {
            signing: "registered",
          });
          if (!res.ok) break;
          const list = await res.json() as string[];
          await Promise.all(
            list.map(async (uri) => {
              if (seen.has(uri)) return;
              seen.add(uri);
              try {
                const aRes = await fetch(uri, {
                  headers: {
                    Accept:
                      'application/ld+json; profile="https://www.w3.org/ns/activitystreams"',
                  },
                });
                if (!aRes.ok) return;
                const actor = await aRes.json();
                const host = (() => {
                  try {
                    return new URL(uri).hostname;
                  } catch {
                    return "";
                  }
                })();
                results.push({
                  type: "user",
                  id: actor.id ?? uri,
                  title: actor.name ?? actor.preferredUsername ?? uri,
                  subtitle: actor.preferredUsername
                    ? `@${actor.preferredUsername}@${host}`
                    : uri,
                  avatar: actor.icon?.url,
                  actor: actor.id ?? uri,
                  origin: host,
                });
              } catch {
                /* ignore */
              }
            }),
          );
          if (seen.size >= maxTotal) break;
          const link = res.headers.get("Link");
          let next: string | undefined;
          if (link) {
            for (const part of link.split(",")) {
              const m = part.match(/<([^>]+)>;\s*rel="next"/);
              if (m) {
                try {
                  next = new URL(m[1], nextUrl).toString();
                } catch {
                  next = m[1];
                }
                break;
              }
            }
          }
          nextUrl = next;
        }
      } catch {
        /* ignore */
      }
    }
  }

  if (type === "all" || type === "posts") {
    const db = getDB(c);
  const posts = await db.posts.findNotes({ content: regex }, {
      published: -1,
    }) as Array<{
      _id?: unknown;
      content?: string;
      attributedTo: string;
      published?: Date;
    }>;
    const sliced = posts.slice(0, 20);
    const domain = getDomain(c);
    for (const p of sliced) {
      results.push({
        type: "post",
        id: String(p._id),
        title: (p.content ?? "").slice(0, 80),
        subtitle: actorToHandle(p.attributedTo),
        metadata: { createdAt: p.published },
        origin: domain,
      });
    }
  }

  if (server) {
    // サーバーホスト名の検証
    const isValidServer = await validateServerHostname(server);
    if (!isValidServer) {
      console.warn(
        `Blocked search request to potentially unsafe server: ${server}`,
      );
      return c.json(results); // 内部結果のみ返す
    }

    let remoteResults: SearchResult[] = [];
    try {
      const url = `https://${server}/api/search?q=${
  encodeURIComponent(q)
      }&type=${type}`;

      // タイムアウト設定
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      try {
        const res = await fetch(url, {
          signal: controller.signal,
          headers: {
            "User-Agent": "takos-search/1.0",
          },
        });

        if (res.ok) {
          remoteResults = await res.json();
          for (const r of remoteResults) {
            results.push({ ...r, origin: server });
          }
        }
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      /* ignore */
    }

    if (remoteResults.length === 0) {
      // 何も取れなかった場合でも、上の WebFinger が結果を返していれば残す
      if (results.length === 0) return c.json([]);
      return c.json(results);
    }
  }

  return c.json(results);
});

export default app;
