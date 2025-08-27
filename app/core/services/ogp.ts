import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.53/deno-dom-wasm.ts";

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
    // ホスト名の場合、DNSリゾルブして検証
    try {
      const resolvedIPs = await Deno.resolveDns(parsedUrl.hostname, "A");
      for (const ip of resolvedIPs) {
        if (isPrivateIP(ip)) {
          throw new Error("DNS resolves to a private IP address");
        }
      }
    } catch (_e) {
      // IPv6も確認
      try {
        const resolvedIPv6 = await Deno.resolveDns(parsedUrl.hostname, "AAAA");
        for (const ip of resolvedIPv6) {
          if (isPrivateIP(ip)) {
            throw new Error("DNS resolves to a private IP address");
          }
        }
      } catch {
        // DNS解決できない場合は続行（外部ドメインの可能性）
      }
    }
  }

  // ポート制限（標準ポート以外を制限）
  const standardPorts = ["", "80", "443", "8080", "8443"];
  if (parsedUrl.port && !standardPorts.includes(parsedUrl.port)) {
    throw new Error(`Non-standard port ${parsedUrl.port} is not allowed`);
  }
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
      const document = new DOMParser().parseFromString(html, "text/html");

      if (!document) {
        return null;
      }

      const getMetaContent = (
        doc: typeof document,
        property: string,
      ): string | undefined => {
        return doc.querySelector(`meta[property="${property}"]`)?.getAttribute(
          "content",
        ) ||
          doc.querySelector(`meta[name="${property}"]`)?.getAttribute(
            "content",
          ) ||
          undefined;
      };

      const title = getMetaContent(document, "og:title") ||
        document.querySelector("title")?.textContent ||
        undefined;
      const description = getMetaContent(document, "og:description") ||
        getMetaContent(document, "description") ||
        undefined;
      const image = getMetaContent(document, "og:image") || undefined;

      return { title, description, image, url };
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    console.error(`Failed to fetch OGP data for ${url}:`, error);
    return null;
  }
}
