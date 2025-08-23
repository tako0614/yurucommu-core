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
    // peer が与えられた場合、Activity の to/cc に peer の actor URI が含まれるものを抽出
    // 指定がない場合は to が自分のみ (to が配列で長さ1か、文字列で自Handle と等しい) のものを抽出
    const peerActorUri = peer
      ? peer.startsWith("http") ? peer : `https://${peer.includes("@") ? peer.split("@")[1] : getDomain()}/users/${encodeURIComponent(peer.includes("@") ? peer.split("@")[0] : peer)}`
      : undefined;

    const filtered = items.filter((it: Record<string, unknown>) => {
      const type = typeof it.type === "string" ? it.type : "";
      if (type !== "Note" && type !== "Message") return false;
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
      } else {
        // 自分のみ向け: recipients がちょうど自Handle のみ
        if (recipients.length === 1 && recipients[0] === selfHandle) return true;
        // または to が "https://www.w3.org/ns/activitystreams#Public" のような public は除外
        return false;
      }
    }).map((it: Record<string, unknown>) => {
      const id = String(it.id ?? it._id ?? "");
      const author = typeof it.attributedTo === "string" ? it.attributedTo : "";
      const content = typeof it.content === "string" ? it.content : "";
      const published = it.published ? new Date(String(it.published)) : new Date();
      const attachments = Array.isArray(it.attachment) ? it.attachment.map((a: any) => ({
        url: a.url ?? a.mediaType ?? undefined,
        mediaType: a.mediaType ?? undefined,
        preview: a.preview ? { url: a.preview.url } : undefined,
      })) : undefined;
      return {
        id,
        author,
        displayName: author.split("/").pop() ?? author,
        address: author,
        content,
        attachments,
        timestamp: published,
        type: "text",
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
 * サーバーの /dm エンドポイントへ POST する。
 * @param from 送信者ハンドル (例: "alice@example.com" か "alice")
 * @param to 受信者ハンドル配列 (ローカル/リモート問わず "user@domain" 形式を期待)
 * @param content 本文
 * @param attachments 省略。将来拡張用
 */
export async function sendDirectMessage(
  from: string,
  to: string[],
  content: string,
  attachments?: { url: string; mediaType?: string }[],
): Promise<boolean> {
  try {
    // サーバー側 /dm は単一 recipient (to) を想定しているため複数送信先がある場合はそれぞれ送信する
    for (const t of to) {
      const payload = {
        from,
        to: t,
        content,
        attachments,
      };
      const res = await apiFetch("/dm", {
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