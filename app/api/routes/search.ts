import { Hono } from "hono";
import { createDB } from "../DB/mod.ts";
import { getDomain, resolveActor } from "../utils/activitypub.ts";
import { getEnv } from "../../shared/config.ts";
import authRequired from "../utils/auth.ts";
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

function isPrivateIP(ip: string): boolean {
  const privateRanges = [
    /^10\./,
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
    /^192\.168\./,
    /^127\./,
    /^0\./,
    /^169\.254\./, // Link-local
    /^fc00:/i,      // IPv6 Unique Local
    /^fd[0-9a-f]{2}:/i,
    /^fe80:/i,      // IPv6 Link-local
    /^::1$/i,       // IPv6 localhost
  ];
  
  return privateRanges.some(range => range.test(ip));
}

async function validateServerHostname(hostname: string): Promise<boolean> {
  // ローカルホストや内部アドレスのブロック
  const blockedHosts = [
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    '169.254.169.254', // AWS metadata
    '::1',
    '::ffff:127.0.0.1'
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
  let q = c.req.query("q")?.trim();
  const type = c.req.query("type") ?? "all";
  let server = c.req.query("server");
  const useFasp = (c.req.query("useFasp") ?? "1") !== "0";
  if (!q) return c.json([]);

  if (!server && q.includes("@")) {
    const parts = q.split("@");
    if (parts.length === 2 && parts[0] && parts[1]) {
      q = parts[0];
      server = parts[1];
    }
  }

  const regex = new RegExp(escapeRegex(q), "i");
  const results: SearchResult[] = [];

  if (type === "all" || type === "users") {
    const env = getEnv(c);
    const db = createDB(env);
    const users = await db.searchAccounts(regex, 20);
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
        let nextUrl = `${faspBase}/account_search/v0/search?term=${
          encodeURIComponent(q)
        }&limit=${perPage}`;
        while (nextUrl && seen.size < maxTotal) {
          const res = await faspFetch(env, nextUrl);
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
    const env = getEnv(c);
    const db = createDB(env);
    const posts = await db.findNotes({ content: regex }, {
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
        subtitle: p.attributedTo,
        metadata: { createdAt: p.published },
        origin: domain,
      });
    }
  }

  if (server) {
    // サーバーホスト名の検証
    const isValidServer = await validateServerHostname(server);
    if (!isValidServer) {
      console.warn(`Blocked search request to potentially unsafe server: ${server}`);
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
            'User-Agent': 'takos-search/1.0'
          }
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

    if (
      (type === "all" || type === "users") &&
      !remoteResults.some((r) => r.type === "user")
    ) {
      const actor = await resolveActor(q, server);
      if (actor) {
        results.push({
          type: "user",
          id: actor.id,
          title: actor.name ?? actor.preferredUsername ?? q,
          subtitle: `@${actor.preferredUsername ?? q}`,
          avatar: actor.icon?.url,
          actor: actor.id,
          origin: server,
        });
      }
    }
  }

  return c.json(results);
});

export default app;
