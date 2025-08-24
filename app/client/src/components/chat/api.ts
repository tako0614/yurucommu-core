import type { ChatMessage } from "./types.ts";
import { apiFetch, getDomain } from "../../utils/config.ts";

/**
 * ActivityPub outbox から自分宛または peer 宛の Note/Message を抽出して返す
 * @param actor actor のユーザー名（例: "alice"）
 * @param peer (optional) 取得対象の相手ハンドル (例: "bob@example.com")。指定しない場合は自分向け(自分のみ)のものを返す
 */
export async function fetchDirectMessages(
  actor: string,
  peer?: string,
): Promise<ChatMessage[]> {
  try {
    const domain = getDomain();
    const url = `/users/${encodeURIComponent(actor)}/outbox`;
    const res = await apiFetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    const items = Array.isArray(data.orderedItems) ? data.orderedItems : [];
    const selfHandle = `https://${domain}/users/${encodeURIComponent(actor)}`;
    // peer が与えられた場合は recipients に peer の actor URI が含まれる DM を抽出
    // 指定がない場合は recipients に自Handle が含まれる DM を抽出
    const peerActorUri = peer
      ? peer.startsWith("http")
        ? peer
        : `https://${
          peer.includes("@") ? peer.split("@")[1] : getDomain()
        }/users/${
          encodeURIComponent(peer.includes("@") ? peer.split("@")[0] : peer)
        }`
      : undefined;

    const filtered = items.filter((it: Record<string, unknown>) => {
      const type = typeof it.type === "string" ? it.type : "";
      const extra = typeof it.extra === "object" && it.extra !== null
        ? it.extra as Record<string, unknown>
        : {};
      const isDM = extra.dm === true || extra.type === "dm" || type === "dm";
      if (!isDM) return false;
      const toField = it.to ?? [];
      const ccField = it.cc ?? [];
      const collect = (v: unknown) => {
        if (!v) return [];
        if (Array.isArray(v)) return v;
        return [v];
      };
      const toArr = collect(toField).map((v) => String(v));
      const ccArr = collect(ccField).map((v) => String(v));
      const recipients = [...toArr, ...ccArr];

      if (peerActorUri) {
        return recipients.includes(peerActorUri);
      }
      return recipients.includes(selfHandle);
    }).map((it: Record<string, unknown>) => {
      const id = String(it.id ?? it._id ?? "");
      const author = typeof it.attributedTo === "string" ? it.attributedTo : "";
      const content = typeof it.content === "string" ? it.content : "";
      const published = it.published
        ? new Date(String(it.published))
        : new Date();
      // ActivityStreams 互換の添付（attachment）をクライアント内部形式に正規化
      type Attachment = {
        url: string;
        mediaType: string;
        preview?: { url?: string };
      };

      const attachments =
        Array.isArray((it as { attachment?: unknown }).attachment)
          ? ((it.attachment as unknown[])
            .map((a: unknown) => {
              const obj = a as { [k: string]: unknown } | undefined;
              const url = typeof obj?.url === "string" ? obj.url : undefined;
              const mediaType = typeof obj?.mediaType === "string"
                ? obj.mediaType
                : undefined;
              const preview = obj?.preview && typeof obj.preview === "object"
                ? {
                  url:
                    typeof (obj.preview as { url?: unknown })?.url === "string"
                      ? (obj.preview as { url?: string }).url
                      : undefined,
                }
                : undefined;
              if (!url || !mediaType) return null;
              return { url, mediaType, preview };
            })
            .filter(Boolean) as unknown) as Attachment[]
          : undefined;
      return {
        id,
        author,
        displayName: author.split("/").pop() ?? author,
        address: author,
        content,
        attachments,
        timestamp: published,
        type: "note",
        avatar: undefined,
        isMe: false,
      } as ChatMessage;
    });

    return filtered;
  } catch (err) {
    console.error("fetchDirectMessages error:", err);
    return [];
  }
}

/**
 * 暗号化なしで DM を送信する
 * サーバーの /api/dm エンドポイントへ POST する。
 * @param from 送信者ハンドル (例: "alice@example.com" か "alice")
 * @param to 受信者ハンドル配列 (ローカル/リモート問わず "user@domain" 形式を期待)
 * @param content 本文
 * @param attachments 添付ファイル
 */
export async function sendDirectMessage(
  from: string,
  to: string[],
  content: string,
  attachments?: Record<string, unknown>[],
): Promise<boolean> {
  try {
    // サーバー側 /api/dm は単一 recipient (to) を想定しているため複数送信先がある場合はそれぞれ送信する
    for (const t of to) {
      // ActivityPub準拠の type を決定
      let apType: "note" | "image" | "video" | "file" = "note";
      const hasText = typeof content === "string" && content.trim().length > 0;
      const firstMediaType =
        Array.isArray(attachments) && attachments.length > 0
          ? String((attachments[0] as { mediaType?: string }).mediaType || "")
          : "";
      if (!hasText && firstMediaType) {
        if (firstMediaType.startsWith("image/")) apType = "image";
        else if (firstMediaType.startsWith("video/")) apType = "video";
        else apType = "file";
      } else {
        apType = "note"; // 本文がある場合は Note とする（添付は許容）
      }
      const payload = {
        from,
        to: t,
        type: apType,
        content,
        attachments,
      };
      const res = await apiFetch("/api/dm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) return false;
    }
    return true;
  } catch (err) {
    console.error("sendDirectMessage error:", err);
    return false;
  }
}
