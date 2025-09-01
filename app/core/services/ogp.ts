export interface OgpData {
  title?: string;
  description?: string;
  image?: string;
  url: string;
}

function isPrivateIP(ip: string): boolean {
  // RFC1918プライベートアドレスとローカルアドレスの確認
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

async function validateUrl(url: string): Promise<void> {
  // URLの解析
  const parsedUrl = new URL(url);

  // プロトコルの制限
  const allowedProtocols = ["http:", "https:"];
  if (!allowedProtocols.includes(parsedUrl.protocol)) {
    throw new Error("Invalid protocol: only HTTP and HTTPS are allowed");
  }

  // ホスト名のブラックリスト
  const blockedHosts = [
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "169.254.169.254", // AWS metadata
    "::1",
    "::ffff:127.0.0.1",
  ];

  if (blockedHosts.includes(parsedUrl.hostname.toLowerCase())) {
    throw new Error("Access to this host is blocked");
  }

  // IPアドレスかどうかチェック
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  const ipv6Regex = /^([0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}$/i;

  if (
    ipv4Regex.test(parsedUrl.hostname) || ipv6Regex.test(parsedUrl.hostname)
  ) {
    if (isPrivateIP(parsedUrl.hostname)) {
      throw new Error("Access to private IP addresses is not allowed");
    }
  } else {
    // Workers では `Deno.resolveDns` が使えないため、DNSによる私有アドレス検査は省略
  }

  // ポート制限（標準ポート以外を制限）
  const standardPorts = ["", "80", "443", "8080", "8443"];
  if (parsedUrl.port && !standardPorts.includes(parsedUrl.port)) {
    throw new Error(`Non-standard port ${parsedUrl.port} is not allowed`);
  }
}

function extractMeta(html: string, names: string[]): string | undefined {
  for (const n of names) {
    const reProp = new RegExp(`<meta[^>]+property=["']${n}["'][^>]*content=["']([^"']+)["'][^>]*>`, "i");
    const m1 = html.match(reProp);
    if (m1 && m1[1]) return m1[1];
    const reName = new RegExp(`<meta[^>]+name=["']${n}["'][^>]*content=["']([^"']+)["'][^>]*>`, "i");
    const m2 = html.match(reName);
    if (m2 && m2[1]) return m2[1];
  }
  return undefined;
}

export async function fetchOgpData(url: string): Promise<OgpData | null> {
  try {
    // URL検証
    await validateUrl(url);

    // タイムアウトとサイズ制限を設定
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000); // 5秒タイムアウト

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: "manual", // リダイレクトの手動処理
        headers: {
          "User-Agent": "takos-ogp-fetcher/1.0",
        },
      });

      // ステータスコードの確認
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // レスポンスサイズの確認
      const contentLength = response.headers.get("content-length");
      if (contentLength && parseInt(contentLength) > 1024 * 1024) { // 1MB制限
        throw new Error("Response too large");
      }

      const html = await response.text();

      const title = extractMeta(html, ["og:title"]) ||
        (html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]);
      const description = extractMeta(html, ["og:description", "description"]);
      const image = extractMeta(html, ["og:image"]);

      return { title: title ?? undefined, description: description ?? undefined, image: image ?? undefined, url };
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    console.error(`Failed to fetch OGP data for ${url}:`, error);
    return null;
  }
}
